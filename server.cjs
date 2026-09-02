var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_dotenv = __toESM(require("dotenv"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_vite = require("vite");
var import_genai = require("@google/genai");
var import_mammoth = __toESM(require("mammoth"), 1);
import_dotenv.default.config();
var app = (0, import_express.default)();
var PORT = 3e3;
app.use(import_express.default.json({ limit: "50mb" }));
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new import_genai.GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
}
async function generateContentWithFallback(ai, params) {
  const modelsToTry = [
    params.model || "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.7-flash",
    "gemini-flash-latest"
  ];
  let lastError = null;
  for (const modelName of modelsToTry) {
    try {
      console.log(`Trying Gemini generation with model: ${modelName}`);
      const response = await ai.models.generateContent({
        ...params,
        model: modelName
      });
      return response;
    } catch (err) {
      console.warn(`Gemini generation failed for model ${modelName}:`, err.message || err);
      lastError = err;
    }
  }
  throw lastError;
}
async function prepareContents(systemPrompt, imageBase64, mimeType, textContent) {
  if (textContent) {
    return [systemPrompt, `Berikut adalah teks dokumen:

${textContent}`];
  }
  if (imageBase64) {
    const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, "");
    const lowerMime = (mimeType || "").toLowerCase();
    const isWord = lowerMime.includes("wordprocessingml") || lowerMime.includes("msword") || lowerMime.includes("doc");
    if (isWord) {
      try {
        const buffer = Buffer.from(cleanBase64, "base64");
        const result = await import_mammoth.default.extractRawText({ buffer });
        const text = result.value || "";
        if (text.trim().length > 0) {
          return [systemPrompt, `Berikut adalah isi teks dari dokumen Word yang diunggah:

${text}`];
        }
      } catch (e) {
        console.warn("Mammoth extraction failed:", e);
      }
    }
    return [
      systemPrompt,
      {
        inlineData: {
          mimeType: mimeType || "application/pdf",
          data: cleanBase64
        }
      },
      "Silakan analisis dokumen di atas dan ekstrak data sesuai instruksi."
    ];
  }
  return [systemPrompt];
}
function safeJsonParse(text) {
  if (!text) return {};
  try {
    let cleaned = text.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```[a-z]*\n?/i, "");
      cleaned = cleaned.replace(/```\s*$/, "");
      cleaned = cleaned.trim();
    }
    return JSON.parse(cleaned);
  } catch (e) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (inner) {
      }
    }
    throw new Error("Gagal memproses respons AI (format JSON tidak valid dari hasil pindai dokumen).");
  }
}
app.post("/api/parse-invitation", async (req, res) => {
  try {
    const { imageBase64, mimeType, textContent } = req.body;
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(400).json({
        error: "GEMINI_API_KEY belum dikonfigurasi di server environment."
      });
    }
    const systemPrompt = `Anda adalah Asisten Administrasi Resmi Puskesmas Kepulauan Seribu Utara & Dinas Kesehatan Provinsi DKI Jakarta.
Tugas Anda adalah membaca dokumen Surat Undangan yang diunggah (bisa berupa dokumen PDF, foto/scan gambar, atau teks), lalu menganalisis dan mengekstrak informasi penting untuk secara otomatis menerbitkan Surat Tugas Kedinasan resmi.

Ekstrak dan susun data dalam format JSON murni dengan atribut berikut:
1. "nomorUndangan": Nomor surat undangan yang dibaca (jika ada, contoh: "123/KG.01.00/2026"). Jika tidak ada, isi string kosong.
2. "pengirimUndangan": Instansi/Pejabat yang mengundang (contoh: "Dinas Kesehatan Provinsi DKI Jakarta" atau "Suku Dinas Kesehatan Kabupaten Administrasi Kepulauan Seribu").
3. "perihalUndangan": Hal/Perihal surat undangan asli.
4. "tentang": JUDUL PERIHAL SURAT TUGAS DALAM HURUF KAPITAL SEMUA. Harus diawali kata kerja formal seperti "MENGHADIRI UNDANGAN...", "MELAKSANAKAN...", "MENGIKUTI KEGIATAN...". (contoh: "MENGHADIRI UNDANGAN SOSIALISASI DAN PENDAMPINGAN INTEGRASI PELAYANAN KESEHATAN PRIMER (ILP)").
5. "dalamRangka": Kalimat "dalam rangka" untuk isi surat tugas. Format standar: "memenuhi Surat Undangan dari [pengirimUndangan] Nomor [nomorUndangan] hal [perihalUndangan], untuk pelaksanaan kegiatan kedinasan serta peningkatan mutu pelayanan kesehatan masyarakat di wilayah Kepulauan Seribu Utara".
6. "hariTanggal": Hari dan Tanggal pelaksanaan kegiatan (contoh: "Rabu / 30 Juli 2026" atau "Kamis s.d Jumat / 6 \u2013 7 Agustus 2026").
7. "waktu": Jam/Waktu pelaksanaan (contoh: "08.30 WIB \u2013 Selesai" atau "09.00 \u2013 16.00 WIB").
8. "acara": Nama ringkas dan jelas mengenai Acara / Agenda Kegiatan (contoh: "Sosialisasi dan Pendampingan Integrasi Pelayanan Kesehatan Primer (ILP)").
9. "tempat": Lokasi / Tempat pelaksanaan kegiatan secara rinci (contoh: "Ruang Rapat Auditorium Lantai 2 Dinas Kesehatan Provinsi DKI Jakarta, Jl. Kesehatan No. 10 Jakarta Pusat").
10. "pesertaDitugaskanText": Nama-nama orang atau posisi pegawai yang disebutkan dalam surat undangan jika ada (contoh: "1 orang Perawat, 1 orang Dokter, dr. Abdul Gafur").
11. "ringkasanUndangan": Ringkasan singkat 1-2 kalimat tentang isi dan tujuan undangan tersebut.`;
    const contentsArray = await prepareContents(systemPrompt, imageBase64, mimeType, textContent);
    const response = await generateContentWithFallback(ai, {
      contents: contentsArray,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: import_genai.Type.OBJECT,
          properties: {
            nomorUndangan: { type: import_genai.Type.STRING },
            pengirimUndangan: { type: import_genai.Type.STRING },
            perihalUndangan: { type: import_genai.Type.STRING },
            tentang: { type: import_genai.Type.STRING },
            dalamRangka: { type: import_genai.Type.STRING },
            hariTanggal: { type: import_genai.Type.STRING },
            waktu: { type: import_genai.Type.STRING },
            acara: { type: import_genai.Type.STRING },
            tempat: { type: import_genai.Type.STRING },
            pesertaDitugaskanText: { type: import_genai.Type.STRING },
            ringkasanUndangan: { type: import_genai.Type.STRING }
          }
        }
      }
    });
    const jsonText = response.text || "{}";
    const parsedData = safeJsonParse(jsonText);
    return res.json({
      success: true,
      data: parsedData
    });
  } catch (error) {
    console.error("Error parsing invitation letter with Gemini:", error);
    return res.status(500).json({
      error: error.message || "Gagal memproses surat undangan dengan AI."
    });
  }
});
app.post("/api/generate-surat-text", async (req, res) => {
  try {
    const { promptText } = req.body;
    if (!promptText) {
      return res.status(400).json({ error: "Prompt text wajib diisi." });
    }
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(400).json({ error: "GEMINI_API_KEY tidak dikonfigurasi." });
    }
    const prompt = `Anda adalah Sekretaris Administrasi Puskesmas Kepulauan Seribu Utara & Dinas Kesehatan Provinsi DKI Jakarta.
Tugas Anda adalah mengubah draf informal berikut menjadi Bahasa Indonesia Formal Baku untuk Surat Tugas Resmi Pemerintah.

Input Informal Pengguna: "${promptText}"

Kembalikan format JSON murni:
{
  "tentang": "JUDUL PERIHAL KAPITAL SEMUA (contoh: PENINGKATAN KAPASITAS PETUGAS...)",
  "dalamRangka": "kalimat huruf kecil di awal 'meningkatkan/melaksanakan/menghadiri...' (contoh: meningkatkan mutu pelayanan kesehatan masyarakat di wilayah Kepulauan Seribu Utara)",
  "acara": "Nama Acara Singkat Rapi (contoh: Pelatihan Dan Pendampingan Petugas Kesehatan)",
  "tempat": "Lokasi Resmi Lengkap (contoh: Ruang Rapat Auditorium Lantai 2 Dinas Kesehatan Provinsi DKI Jakarta)"
}`;
    const response = await generateContentWithFallback(ai, {
      model: "gemini-3.6-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });
    const jsonText = response.text || "{}";
    const parsedData = safeJsonParse(jsonText);
    return res.json({ success: true, data: parsedData });
  } catch (error) {
    console.error("Error generating surat text with Gemini:", error);
    return res.status(500).json({ error: error.message || "Gagal memproses teks dengan AI." });
  }
});
app.post("/api/generate-undangan", async (req, res) => {
  try {
    const { promptText, defaultDate, defaultSuffix } = req.body;
    if (!promptText) {
      return res.status(400).json({ error: "Prompt atau keterangan rapat wajib diisi." });
    }
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(400).json({ error: "GEMINI_API_KEY tidak dikonfigurasi." });
    }
    const prompt = `Anda adalah Sekretaris Administrasi Puskesmas Kepulauan Seribu Utara & Dinas Kesehatan Provinsi DKI Jakarta.
Tugas Anda adalah membuat data Surat Undangan Resmi Pemerintah yang berwibawa, sangat formal, dan lengkap berdasarkan deskripsi singkat dari pengguna berikut:
"${promptText}"

Gunakan tanggal surat bawaan: "${defaultDate || "2 Agustus 2026"}" dan suffix kode surat bawaan: "${defaultSuffix || "KG.11.00"}".

Kembalikan format JSON murni yang sesuai dengan interface SuratUndangan berikut:
{
  "nomorSurat": "Nomor surat undangan otomatis, contoh: '187' atau '440/012'",
  "kodeSuratSuffix": "Gunakan '${defaultSuffix || "KG.11.00"}' atau sesuaikan jika ada klasifikasi kode yang lebih cocok",
  "sifat": "Penting",
  "lampiran": "- (atau '1 Berkas' jika rapat memerlukan lampiran agenda)",
  "hal": "Hal/Perihal undangan formal diawali 'Undangan Rapat...', 'Undangan Pertemuan...', atau 'Undangan Sosialisasi...'. Gunakan kalimat formal, contoh: 'Undangan Rapat Koordinasi Program Kesehatan'",
  "tanggalSurat": "${defaultDate || "2 Agustus 2026"}",
  "kepada": "Yth. [Sebutkan penerima yang relevan dengan deskripsi rapat, misal: 'Para Kepala Satuan Pelaksana Puskesmas', 'Para Petugas Program Stunting', atau 'Seluruh Pegawai Puskesmas Kepulauan Seribu Utara']\\ndi\\nTempat",
  "pembuka": "Sehubungan dengan upaya peningkatan mutu pelayanan kesehatan, koordinasi program kerja, serta pelaksanaan tugas kedinasan di lingkungan Puskesmas Kepulauan Seribu Utara, dengan ini kami mengharapkan kehadiran Bapak/Ibu/Saudara untuk menghadiri rapat/pertemuan yang akan diselenggarakan pada:",
  "hariTanggal": "Hari dan tanggal kegiatan rapat formal (misal: 'Selasa / 4 Agustus 2026' - sesuaikan dengan deskripsi rapat)",
  "waktu": "Waktu pelaksanaan (misal: '09.00 WIB s.d Selesai' atau '13.00 WIB s.d 15.30 WIB')",
  "acara": "Agenda/Acara rapat formal terperinci, contoh: 'Rapat Koordinasi Evaluasi Program Stunting Triwulan II'",
  "tempat": "Lokasi pertemuan/rapat resmi (misal: 'Aula Lantai 2 Puskesmas Kepulauan Seribu Utara' atau 'Ruang Pertemuan Puskesmas Kelurahan Pulau Kelapa')",
  "penutup": "Mengingat pentingnya agenda rapat ini, dimohon kehadiran Bapak/Ibu/Saudara tepat pada waktunya dan tidak diwakilkan. Demikian undangan ini disampaikan, atas perhatian dan kerjasamanya kami ucapkan terima kasih."
}

Pastikan teks yang dihasilkan menggunakan Bahasa Indonesia formal administrasi DKI Jakarta yang santun, rapi, dan sesuai standar tata naskah dinas resmi.`;
    const response = await generateContentWithFallback(ai, {
      model: "gemini-3.6-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });
    const jsonText = response.text || "{}";
    const parsedData = JSON.parse(jsonText);
    return res.json({ success: true, data: parsedData });
  } catch (error) {
    console.error("Error generating invitation letter with Gemini:", error);
    return res.status(500).json({ error: error.message || "Gagal memproses pembuatan surat undangan otomatis." });
  }
});
app.post("/api/scan-faktur", async (req, res) => {
  try {
    const { imageBase64, mimeType, textContent } = req.body;
    if (!imageBase64 && !textContent) {
      return res.status(400).json({ error: "Data gambar atau teks faktur wajib dikirimkan." });
    }
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(400).json({ error: "GEMINI_API_KEY belum dikonfigurasi di server environment." });
    }
    const systemPrompt = `Anda adalah sistem OCR cerdas yang dikhususkan untuk membaca Faktur Pengadaan Barang / Bahan Medis / Obat-obatan Farmasi (misalnya dari Kimia Farma, dll).
Tugas Anda adalah membaca gambar atau dokumen faktur pengadaan yang diunggah dan mengekstrak informasi-informasi berikut dengan akurasi tinggi:
- pengirim (Vendor atau instansi pengirim faktur, misalnya "Kimia Farma Trading & Distribution" atau "Kimia Farma")
- noFaktur (Nomor faktur / invoice number / invoice No, contoh: "2809378644")
- tanggalFaktur (Tanggal faktur dikeluarkan/Invoice Date, dalam format YYYY-MM-DD atau DD.MM.YYYY, contoh "10.08.2026")
- items (Daftar barang/material yang tercantum dalam faktur, berupa array objek)

Untuk setiap item dalam daftar barang, ekstrak atribut berikut:
- material (Nama barang / deskripsi produk obat atau bahan medis, contoh "RETINOL PALMITATE 200,000 IU (BT 50)")
- batchEd (Kombinasi Nomor Batch dan Expiry Date, contoh "D60671W \u2022 26.04.2028" atau "Batch: F61223W, ED: 01.06.2028")
- qty (Jumlah kuantitas barang, sebagai angka integer murni, contoh: 15)
- uom (Unit Satuan / Unit of Measure, contoh: "BT", "KPS", "BOX", "PCS")
- price (Harga per unit dalam Rupiah. PENTING: Jika harga satuan memiliki pecahan desimal di gambar faktur/SBBK seperti pada kolom Harga Satuan (Botol) - contoh: 10551,40 atau 15568,60 - Anda WAJIB membulatkannya ke atas / round up ke bilangan bulat terdekat, contoh: 10551.40 menjadi 10552, 15568.60 menjadi 15569)
- disc (Diskon dalam persen, jika tidak ada isi dengan 0, contoh: 0.00 atau 5)
- amount (Total nominal rupiah untuk baris barang tersebut, sesuaikan hasil perkalian setelah harga satuan (price) dibulatkan ke atas, contoh: qty * price * (1 - disc/100))

Kalkulasikan atau ekstrak total nilai transaksi jika diperlukan. Berikan output dalam bentuk JSON murni yang sesuai dengan skema JSON yang didefinisikan.`;
    const contentsArray = await prepareContents(systemPrompt, imageBase64, mimeType, textContent);
    const response = await generateContentWithFallback(ai, {
      contents: contentsArray,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: import_genai.Type.OBJECT,
          properties: {
            pengirim: { type: import_genai.Type.STRING },
            noFaktur: { type: import_genai.Type.STRING },
            tanggalFaktur: { type: import_genai.Type.STRING },
            items: {
              type: import_genai.Type.ARRAY,
              items: {
                type: import_genai.Type.OBJECT,
                properties: {
                  material: { type: import_genai.Type.STRING },
                  batchEd: { type: import_genai.Type.STRING },
                  qty: { type: import_genai.Type.INTEGER },
                  uom: { type: import_genai.Type.STRING },
                  price: { type: import_genai.Type.NUMBER },
                  disc: { type: import_genai.Type.NUMBER },
                  amount: { type: import_genai.Type.NUMBER }
                },
                required: ["material", "batchEd", "qty", "uom", "price", "disc", "amount"]
              }
            }
          },
          required: ["pengirim", "noFaktur", "tanggalFaktur", "items"]
        }
      }
    });
    const jsonText = response.text || "{}";
    const parsedData = safeJsonParse(jsonText);
    return res.json({
      success: true,
      data: parsedData
    });
  } catch (error) {
    console.error("Error scanning faktur with Gemini:", error);
    return res.status(500).json({
      error: error.message || "Gagal memindai gambar faktur dengan AI."
    });
  }
});
app.post("/api/parse-berkas", async (req, res) => {
  try {
    const { imageBase64, mimeType, textContent } = req.body;
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(400).json({
        error: "GEMINI_API_KEY belum dikonfigurasi di server environment."
      });
    }
    const systemPrompt = `Anda adalah Asisten Kearsipan Digital Resmi Puskesmas Kepulauan Seribu Utara & Dinas Kesehatan Provinsi DKI Jakarta.
Tugas Anda adalah membaca dokumen arsip/surat/laporan yang diunggah (bisa berupa dokumen PDF, foto/scan gambar, atau teks draf), lalu menganalisis dan mengekstrak informasi penting untuk disusun ke dalam format Buku Agenda Daftar Berkas Kearsipan Resmi (16 kolom naskah dinas).

Analisis naskah dokumen dengan teliti dan ekstrak data dalam format JSON murni dengan atribut-atribut berikut:
1. "noBerkas": Nomor berkas dinas (contoh: "004/P-TU/2026"). Jika tidak ada, buatkan nomor berkas berformat [nomor]/[kode-bidang]/2026 yang sesuai dengan jenis konten naskah dokumen.
2. "kodeKlasifikasi": Kode klasifikasi arsip yang cocok (contoh: "HK.01.01" untuk Keputusan/Hukum, "KP.01.02" untuk Kepegawaian, "KG.11.00" untuk KIA/Laporan Kesehatan, "KU.00.00" untuk Keuangan, "PR.00.00" untuk Humas/Protokol).
3. "namaBerkas": Judul ringkas berkas/arsip (contoh: "Berkas Pertanggungjawaban BOK Puskesmas Tahun 2026").
4. "uraianInformasi": Deskripsi detail mengenai isi, maksud, ruang lingkup, dan konteks dokumen tersebut agar memudahkan pencarian arsip secara komprehensif.
5. "kurunWaktu": Tahun pelaksanaan atau kurun waktu dokumen (contoh: "2026" atau "2025 - 2026").
6. "jumlahArsip": Jumlah fisik arsip (contoh: "1 Berkas", "1 Jilid", "10 Lembar").
7. "tingkatPerkembangan": Tingkat perkembangan naskah. Wajib berupa salah satu nilai: "Asli", "Copy", "Asli & Copy", "Draft".
8. "hakAkses": Hak akses keamanan. Wajib berupa salah satu nilai: "Biasa", "Terbatas", "Rahasia", "Sangat Rahasia".
9. "retensiVital": Apakah berkas vital bagi kelangsungan instansi? Wajib bernilai: "Ya" atau "Tidak".
10. "retensiAktif": Masa simpan aktif berkas (contoh: "2 Tahun").
11. "retensiInaktif": Masa simpan inaktif berkas (contoh: "3 Tahun").
12. "retensiKeterangan": Tindakan akhir berkas. Wajib bernilai salah satu dari: "Musnah", "Simpan Permanen", "Dinilai Kembali".
13. "lokasiBoks": Lokasi nomor boks penyimpanan (contoh: "B-01" atau "B-02" atau "B-03").
14. "lokasiRak": Lokasi nomor rak penyimpanan (contoh: "R-01" atau "R-02" atau "R-03").
15. "kategori": Kategori klasifikasi utama. Wajib bernilai salah satu dari: "Keputusan", "Kepegawaian", "Laporan Pelayanan", "Keuangan", "Humas", "Aset", "Lainnya".
16. "keterangan": Catatan tambahan mengenai kelengkapan atau kondisi fisik arsip (contoh: "Kondisi Baik dan Lengkap").`;
    const contentsArray = await prepareContents(systemPrompt, imageBase64, mimeType, textContent);
    const response = await generateContentWithFallback(ai, {
      contents: contentsArray,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: import_genai.Type.OBJECT,
          properties: {
            noBerkas: { type: import_genai.Type.STRING },
            kodeKlasifikasi: { type: import_genai.Type.STRING },
            namaBerkas: { type: import_genai.Type.STRING },
            uraianInformasi: { type: import_genai.Type.STRING },
            kurunWaktu: { type: import_genai.Type.STRING },
            jumlahArsip: { type: import_genai.Type.STRING },
            tingkatPerkembangan: { type: import_genai.Type.STRING },
            hakAkses: { type: import_genai.Type.STRING },
            retensiVital: { type: import_genai.Type.STRING },
            retensiAktif: { type: import_genai.Type.STRING },
            retensiInaktif: { type: import_genai.Type.STRING },
            retensiKeterangan: { type: import_genai.Type.STRING },
            lokasiBoks: { type: import_genai.Type.STRING },
            lokasiRak: { type: import_genai.Type.STRING },
            kategori: { type: import_genai.Type.STRING },
            keterangan: { type: import_genai.Type.STRING }
          },
          required: [
            "noBerkas",
            "kodeKlasifikasi",
            "namaBerkas",
            "uraianInformasi",
            "kurunWaktu",
            "jumlahArsip",
            "tingkatPerkembangan",
            "hakAkses",
            "retensiVital",
            "retensiAktif",
            "retensiInaktif",
            "retensiKeterangan",
            "lokasiBoks",
            "lokasiRak",
            "kategori",
            "keterangan"
          ]
        }
      }
    });
    const jsonText = response.text || "{}";
    const parsedData = safeJsonParse(jsonText);
    return res.json({
      success: true,
      data: parsedData
    });
  } catch (error) {
    console.error("Error parsing berkas with Gemini:", error);
    return res.status(500).json({
      error: error.message || "Gagal menganalisis berkas dengan AI."
    });
  }
});
app.post("/api/parse-surat-masuk", async (req, res) => {
  try {
    const { imageBase64, mimeType, textContent } = req.body;
    const ai = getGeminiClient();
    if (!ai) {
      return res.status(400).json({
        error: "GEMINI_API_KEY belum dikonfigurasi di server environment."
      });
    }
    const systemPrompt = `Anda adalah Asisten Administrasi Persuratan Resmi Puskesmas Kepulauan Seribu Utara & Dinas Kesehatan Provinsi DKI Jakarta.
Tugas Anda adalah membaca dokumen Surat Masuk / Undangan / Naskah Dinas yang diunggah (bisa berupa dokumen PDF, foto/scan gambar, atau dokumen Word/teks), lalu menganalisis dan mengekstrak informasi penting untuk mengisi form Registrasi Surat Masuk.

Ekstrak dan susun data dalam format JSON murni dengan atribut berikut:
1. "nomorSurat": Nomor surat masuk yang tertera (contoh: "421/SK/DINKES/2026").
2. "pengirim": Instansi atau pihak pengirim surat (contoh: "Dinas Kesehatan Provinsi DKI Jakarta").
3. "perihal": Perihal atau isi ringkas surat.
4. "tanggalSurat": Tanggal surat dikeluarkan dalam format YYYY-MM-DD (jika ada, contoh: "2026-08-26"). Jika tidak ada, isi string kosong.
5. "tanggalDiterima": Tanggal diterima surat dalam format YYYY-MM-DD. Jika tidak ada, gunakan tanggal hari ini atau kosong.
6. "lampiran": Keterangan lampiran (contoh: "1 berkas", "2 lembar", "-").
7. "catatan": Catatan atau disposisi ringkas jika ada.`;
    const contentsArray = await prepareContents(systemPrompt, imageBase64, mimeType, textContent);
    const response = await generateContentWithFallback(ai, {
      contents: contentsArray,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: import_genai.Type.OBJECT,
          properties: {
            nomorSurat: { type: import_genai.Type.STRING },
            pengirim: { type: import_genai.Type.STRING },
            perihal: { type: import_genai.Type.STRING },
            tanggalSurat: { type: import_genai.Type.STRING },
            tanggalDiterima: { type: import_genai.Type.STRING },
            lampiran: { type: import_genai.Type.STRING },
            catatan: { type: import_genai.Type.STRING }
          },
          required: ["nomorSurat", "pengirim", "perihal"]
        }
      }
    });
    const jsonText = response.text || "{}";
    const parsedData = safeJsonParse(jsonText);
    return res.json({
      success: true,
      data: parsedData
    });
  } catch (error) {
    console.error("Error parsing surat masuk with Gemini:", error);
    return res.status(500).json({
      error: error.message || "Gagal memindai Surat Masuk dengan AI."
    });
  }
});
var REQUEST_HISTORY_FILE = import_path.default.join(process.cwd(), "requests_history.json");
function readRequestHistory() {
  try {
    if (import_fs.default.existsSync(REQUEST_HISTORY_FILE)) {
      const data = import_fs.default.readFileSync(REQUEST_HISTORY_FILE, "utf8");
      let history = JSON.parse(data);
      if (Array.isArray(history)) {
        const seenNumbers = /* @__PURE__ */ new Set();
        let currentMax = 1454;
        history.forEach((h) => {
          const m = h.nomorSurat ? h.nomorSurat.toString().match(/\d+/) : null;
          const n = m ? parseInt(m[0], 10) : NaN;
          if (!isNaN(n) && n > currentMax) {
            currentMax = n;
          }
        });
        history = history.map((h) => {
          const m = h.nomorSurat ? h.nomorSurat.toString().match(/\d+/) : null;
          let n = m ? parseInt(m[0], 10) : NaN;
          if (isNaN(n) || seenNumbers.has(n)) {
            currentMax++;
            n = currentMax;
            return { ...h, nomorSurat: n.toString() };
          }
          seenNumbers.add(n);
          return h;
        });
        return history;
      }
    }
  } catch (err) {
    console.error("Error reading request history file:", err);
  }
  return [];
}
function writeRequestHistory(history) {
  try {
    import_fs.default.writeFileSync(REQUEST_HISTORY_FILE, JSON.stringify(history, null, 2), "utf8");
  } catch (err) {
    console.error("Error writing request history file:", err);
  }
}
app.get("/api/request-history", (req, res) => {
  const history = readRequestHistory();
  res.json({ success: true, data: history });
});
app.post("/api/request-history", (req, res) => {
  const newRecord = req.body;
  if (!newRecord || !newRecord.id || !newRecord.nomorSurat) {
    return res.status(400).json({ error: "Data permohonan nomor tidak lengkap." });
  }
  const history = readRequestHistory();
  const existingNumbers = /* @__PURE__ */ new Set();
  let maxNum = 1454;
  history.forEach((h) => {
    if (h.id !== newRecord.id) {
      const m = h.nomorSurat ? h.nomorSurat.toString().match(/\d+/) : null;
      const n = m ? parseInt(m[0], 10) : NaN;
      if (!isNaN(n)) {
        existingNumbers.add(n);
        if (n > maxNum) maxNum = n;
      }
    }
  });
  const currentNumParsed = newRecord.nomorSurat ? parseInt(newRecord.nomorSurat.toString().replace(/\D/g, ""), 10) : NaN;
  if (isNaN(currentNumParsed) || existingNumbers.has(currentNumParsed)) {
    const assignedNum = maxNum + 1;
    newRecord.nomorSurat = assignedNum.toString();
  }
  const index = history.findIndex((h) => h.id === newRecord.id);
  if (index >= 0) {
    history[index] = newRecord;
  } else {
    history.unshift(newRecord);
  }
  writeRequestHistory(history);
  res.json({ success: true, data: newRecord });
});
app.delete("/api/request-history/:id", (req, res) => {
  const { id } = req.params;
  const history = readRequestHistory();
  const updated = history.filter((h) => h.id !== id);
  writeRequestHistory(updated);
  res.json({ success: true });
});
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}
startServer();
//# sourceMappingURL=server.cjs.map
