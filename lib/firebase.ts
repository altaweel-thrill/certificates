import { getApp, getApps, initializeApp } from "firebase/app";

export const firebaseConfig = {
  apiKey: "AIzaSyCKaSzQv2P-hl3rO-L1bmSk_cnRZp2Utsc",
  authDomain: "certificates-cd263.firebaseapp.com",
  projectId: "certificates-cd263",
  storageBucket: "certificates-cd263.firebasestorage.app",
  messagingSenderId: "12932372707",
  appId: "1:12932372707:web:59cfa01bb074761818cdd6",
} as const;

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

export async function getFirebaseAuth() {
  const { getAuth } = await import("firebase/auth");
  return getAuth(firebaseApp);
}

export async function getFirebaseFirestore() {
  const { getFirestore } = await import("firebase/firestore");
  return getFirestore(firebaseApp);
}

export async function getFirebaseStorage() {
  const { getStorage } = await import("firebase/storage");
  return getStorage(firebaseApp);
}

export async function getFirebaseFunctions() {
  const { getFunctions } = await import("firebase/functions");
  return getFunctions(firebaseApp, "europe-west1");
}
