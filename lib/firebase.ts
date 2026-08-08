import { getApp, getApps, initializeApp } from "firebase/app";

function requiredEnvironmentVariable(name: string, value: string | undefined) {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const firebaseConfig = {
  apiKey: requiredEnvironmentVariable("NEXT_PUBLIC_FIREBASE_API_KEY", process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
  authDomain: requiredEnvironmentVariable("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
  projectId: requiredEnvironmentVariable("NEXT_PUBLIC_FIREBASE_PROJECT_ID", process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
  storageBucket: requiredEnvironmentVariable("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: requiredEnvironmentVariable("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID),
  appId: requiredEnvironmentVariable("NEXT_PUBLIC_FIREBASE_APP_ID", process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
} as const;

const firebaseFunctionsRegion = process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION || "europe-west1";

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
  return getFunctions(firebaseApp, firebaseFunctionsRegion);
}
