import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../lib/certificate-upload.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup(records) {
  const uploads = [];
  const updates = [];
  const lookups = [];
  function snapshot(record, id) {
    return { id, ref: { id }, exists: () => Boolean(record), data: () => record };
  }
  const firestore = {
    collection: () => ({}),
    doc: (_db, _collection, id) => ({ id }),
    getDoc: async ({ id }) => snapshot(records.find((item) => item.id === id), id),
    where: (field, _operator, value) => ({ field, value }),
    limit: (count) => ({ count }),
    query: (_collection, filter, bound) => ({ ...filter, ...bound }),
    getDocs: async ({ field, value, count }) => {
      lookups.push(field);
      const docs = records.filter((item) => item[field] === value).slice(0, count).map((item) => snapshot(item, item.id));
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
    serverTimestamp: () => "timestamp",
    updateDoc: async (reference, data) => { updates.push({ reference, data }); },
  };
  const storage = {
    ref: (_storage, path) => ({ path }),
    uploadBytesResumable: (reference, file, metadata) => {
      uploads.push({ reference, file, metadata });
      return { on: (_event, progress, _error, complete) => {
        progress({ bytesTransferred: file.size, totalBytes: file.size });
        complete();
      } };
    },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: (name) => {
      if (name === "firebase/firestore") return firestore;
      if (name === "firebase/storage") return storage;
      if (name === "./firebase") return {
        getFirebaseAuth: async () => ({ currentUser: { uid: "admin", email: "admin@example.test" } }),
        getFirebaseFirestore: async () => ({}),
        getFirebaseStorage: async () => ({}),
      };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return { upload: exports.uploadCertificateByFileName, uploads, updates, lookups };
}

const overlappingRecords = [
  { id: "7247", certificateNumber: "7247", ctrId: "11" },
  { id: "2345", certificateNumber: "2345", ctrId: "7247" },
];
const pdf = (name) => ({ name, type: "application/pdf", size: 100 });

test("new naming mode selects CertificateNo when another record has the same CTRID", async () => {
  const context = setup(overlappingRecords);
  const result = await context.upload(pdf("i_7247.pdf"), "certificate-number");
  assert.equal(result.certificateId, "7247");
  assert.equal(result.normalizedFileName, "i_7247.pdf");
  assert.equal(result.matchedLegacyCtrId, "");
  assert.equal(context.lookups.includes("ctrId"), false);
});

test("old naming mode selects CTRID and converts bare and prefixed international names", async () => {
  for (const name of ["7247.pdf", "i_7247.pdf"]) {
    const context = setup(overlappingRecords);
    const result = await context.upload(pdf(name), "legacy-ctrid");
    assert.equal(result.certificateId, "2345");
    assert.equal(result.normalizedFileName, "i_2345.pdf");
    assert.equal(result.matchedLegacyCtrId, "7247");
    assert.deepEqual(context.lookups, ["ctrId"]);
    assert.equal(context.updates[0].data["files.international.sourceFileName"], name);
    assert.equal(context.uploads[0].reference.path, "certificates/2345/international/i_2345.pdf");
  }
});

test("old card names remain cards after conversion", async () => {
  const context = setup(overlappingRecords);
  const result = await context.upload(pdf("c_7247.pdf"), "legacy-ctrid");
  assert.equal(result.fileType, "card");
  assert.equal(result.normalizedFileName, "c_2345.pdf");
});

test("new naming mode never falls back to CTRID", async () => {
  const context = setup([overlappingRecords[1]]);
  await assert.rejects(context.upload(pdf("7247.pdf"), "certificate-number"), /CertificateNo/);
  assert.deepEqual(context.lookups, ["certificateNumber"]);
  assert.equal(context.uploads.length, 0);
});

test("old naming mode never falls back to CertificateNo", async () => {
  const context = setup([overlappingRecords[0]]);
  await assert.rejects(context.upload(pdf("7247.pdf"), "legacy-ctrid"), /CTRID/);
  assert.equal(context.uploads.length, 0);
});

test("ambiguous CTRID blocks uploads before writing any data", async () => {
  const context = setup([overlappingRecords[1], { id: "3456", certificateNumber: "3456", ctrId: "7247" }]);
  await assert.rejects(context.upload(pdf("7247.pdf"), "legacy-ctrid"), /بأكثر من شهادة/);
  assert.equal(context.uploads.length, 0);
  assert.equal(context.updates.length, 0);
});

test("converted legacy uploads cannot replace an existing international certificate", async () => {
  const context = setup([{ ...overlappingRecords[1], files: { international: { storagePath: "existing.pdf" } } }]);
  await assert.rejects(context.upload(pdf("7247.pdf"), "legacy-ctrid"), { code: "certificate/already-uploaded" });
  assert.equal(context.uploads.length, 0);
});
