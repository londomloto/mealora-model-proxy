// Output contract between this proxy and the Mealora mobile client.
// Every numeric field is reported with the model's own confidence so the
// review screen can mark it "confident" / "needs_check" / "unread" — the
// proxy must never fabricate a value and must never collapse a missing
// read into zero. See openspec/changes/010-nutrition-label-extraction
// specs/nutrition-label-extraction/spec.md — "Nilai yang tidak terbaca
// tetap belum diketahui".

const CONFIDENCE_ENUM = ['confident', 'needs_check', 'unread'];

function valueField(valueType) {
  return {
    type: 'object',
    properties: {
      value: { type: valueType, nullable: true },
      unit: { type: 'string', nullable: true },
      confidence: { type: 'string', enum: CONFIDENCE_ENUM },
    },
    required: ['confidence'],
  };
}

const EXTRACTION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    basis: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['per_serving', 'per_100g', 'unread'],
        },
        confidence: { type: 'string', enum: CONFIDENCE_ENUM },
      },
      required: ['kind', 'confidence'],
    },
    servingSize: valueField('number'),
    servingsPerPackage: valueField('number'),
    energyKcal: valueField('number'),
    proteinGrams: valueField('number'),
    carbohydrateGrams: valueField('number'),
    fatGrams: valueField('number'),
  },
  required: [
    'basis',
    'servingSize',
    'servingsPerPackage',
    'energyKcal',
    'proteinGrams',
    'carbohydrateGrams',
    'fatGrams',
  ],
};

const EXTRACTION_PROMPT = `Anda membaca panel "Informasi Nilai Gizi" pada foto kemasan makanan Indonesia.

Baca HANYA panel Informasi Nilai Gizi. Jangan baca daftar bahan, klaim gizi, atau sertifikasi.

Untuk setiap nilai:
- Jika tercetak jelas dan Anda yakin, laporkan dengan confidence "confident".
- Jika tercetak tapi buram, satuannya ambigu, atau Anda ragu, laporkan nilai terbaik Anda dengan confidence "needs_check".
- Jika benar-benar tidak terlihat atau tidak ada pada foto, kembalikan value null dengan confidence "unread". JANGAN PERNAH menebak atau mengembalikan 0 sebagai pengganti nilai yang tidak terbaca.

Basis nilai gizi:
- "per_serving" jika label menyatakan nilai per takaran saji / per sajian.
- "per_100g" jika label menyatakan nilai per 100 g atau per 100 ml.
- "unread" jika basis tidak dapat dipastikan dari foto — jangan menebak basis.

servingSize adalah ukuran satu sajian dalam gram/ml (angka saja, unit di field unit).
servingsPerPackage adalah jumlah sajian per kemasan bila tercantum.
energyKcal, proteinGrams, carbohydrateGrams, fatGrams mengikuti basis yang sama (per sajian ATAU per 100 g, bukan keduanya dicampur).

Kembalikan hanya JSON sesuai skema yang diberikan, tanpa teks lain.`;

// Component recognition contract (change 011-food-photo-input). The model
// proposes WHAT is on the plate and roughly HOW MUCH — it never proposes
// nutrition values. Nutrition always comes from the mobile client's catalog
// match, never from this response. See
// openspec/changes/011-food-photo-input/design.md D1.

const FOOD_COMPONENT_SCHEMA = {
  type: 'object',
  properties: {
    foodName: { type: 'string' },
    quantity: {
      type: 'object',
      properties: {
        value: { type: 'number', nullable: true },
        unit: { type: 'string', nullable: true },
        confidence: { type: 'string', enum: CONFIDENCE_ENUM },
      },
      required: ['confidence'],
    },
    cookingMethod: {
      type: 'object',
      properties: {
        value: { type: 'string', nullable: true },
        confidence: { type: 'string', enum: CONFIDENCE_ENUM },
      },
      required: ['confidence'],
    },
  },
  required: ['foodName', 'quantity', 'cookingMethod'],
};

const COMPONENT_RECOGNITION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    components: { type: 'array', items: FOOD_COMPONENT_SCHEMA },
  },
  required: ['components'],
};

const COMPONENT_RECOGNITION_PROMPT = `Anda melihat foto sepiring makanan Indonesia.

Identifikasi SETIAP komponen makanan yang terlihat terpisah di piring (mis. nasi, lauk, sayur, sambal) sebagai entri tersendiri — jangan gabungkan beberapa komponen berbeda menjadi satu entri, dan jangan pecah satu hidangan majemuk (mis. "nasi goreng") menjadi beberapa entri.

Untuk setiap komponen, laporkan:
- foodName: nama makanan dalam Bahasa Indonesia, sesingkat dan sejelas mungkin (mis. "ayam bakar", "tempe goreng").
- quantity: perkiraan jumlah dan satuan yang wajar untuk makanan ini (mis. value 1, unit "potong"). Jika Anda benar-benar tidak dapat memperkirakan jumlahnya, kembalikan value null dengan confidence "unread". Jika Anda yakin pada perkiraan Anda, confidence "confident"; jika ragu, confidence "needs_check".
- cookingMethod: metode memasak bila terlihat jelas dan memengaruhi nilai gizi (mis. "digoreng", "dikukus", "dibakar"). Jika tidak terlihat atau tidak relevan, kembalikan value null dengan confidence "unread". Jika metodenya bisa salah satu dari beberapa kemungkinan, kembalikan tebakan terbaik dengan confidence "needs_check".

JANGAN PERNAH melaporkan nilai gizi (kalori, protein, karbohidrat, lemak) untuk komponen apa pun — itu bukan bagian dari tugas ini dan akan diabaikan oleh sistem.

Kembalikan hanya JSON sesuai skema yang diberikan, tanpa teks lain.`;

module.exports = {
  EXTRACTION_RESPONSE_SCHEMA,
  EXTRACTION_PROMPT,
  COMPONENT_RECOGNITION_RESPONSE_SCHEMA,
  COMPONENT_RECOGNITION_PROMPT,
  CONFIDENCE_ENUM,
};
