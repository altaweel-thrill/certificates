import type { Unsubscribe, User } from "firebase/auth";
import type { AdminProfile } from "./admin-auth";
import { getFirebaseAuth, getFirebaseFirestore } from "./firebase";

export type TraineeProfile = {
  uid: string;
  name: string;
  nationalId: string;
  phoneNumber: string;
  traineeDocumentId: string;
};

export type CompanyProfile = {
  uid: string;
  name: string;
  email: string;
  companyDocumentId: string;
  companyName: string;
  crNumber: string;
};

export type PlatformSession =
  | { role: "admin"; profile: AdminProfile }
  | { role: "trainee"; profile: TraineeProfile }
  | { role: "company"; profile: CompanyProfile };

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function displayName(data: Record<string, unknown>, user: User) {
  return text(data.name) || text(data.displayName) || user.displayName || user.email?.split("@")[0] || "مستخدم";
}

async function resolvePlatformSession(user: User): Promise<PlatformSession | null> {
  const { doc, getDoc } = await import("firebase/firestore");
  const database = await getFirebaseFirestore();
  const [token, userSnapshot] = await Promise.all([
    user.getIdTokenResult(),
    getDoc(doc(database, "users", user.uid)),
  ]);
  const data = userSnapshot.data() ?? {};

  if (data.disabled === true) return null;

  const storedRole = text(data.role);
  const tokenRole = text(token.claims.role);
  const companyDocumentId = text(data.companyDocumentId) || text(token.claims.companyDocumentId);
  if ((storedRole === "company_admin" || tokenRole === "company_admin") && companyDocumentId) {
    const companySnapshot = await getDoc(doc(database, "companies", companyDocumentId));
    const company = companySnapshot.data() ?? {};
    if (!companySnapshot.exists() || text(company.status) === "disabled") return null;
    return {
      role: "company",
      profile: {
        uid: user.uid,
        name: displayName(data, user),
        email: user.email || text(data.email),
        companyDocumentId,
        companyName: text(company.name) || "حساب الشركة",
        crNumber: text(company.crNumber),
      },
    };
  }

  if (storedRole === "admin" || storedRole === "super_admin" || tokenRole === "admin" || tokenRole === "super_admin" || token.claims.admin === true) {
    return {
      role: "admin",
      profile: {
        uid: user.uid,
        name: displayName(data, user),
        email: user.email || text(data.email),
        role: storedRole === "super_admin" || tokenRole === "super_admin" ? "super_admin" : "admin",
      },
    };
  }

  const traineeDocumentId = text(data.traineeDocumentId);
  if (storedRole === "trainee" && traineeDocumentId) {
    return {
      role: "trainee",
      profile: {
        uid: user.uid,
        name: displayName(data, user),
        nationalId: text(data.nationalId),
        phoneNumber: user.phoneNumber || text(data.phoneNumber),
        traineeDocumentId,
      },
    };
  }

  return null;
}

export async function observePlatformSession(onChange: (session: PlatformSession | null) => void): Promise<Unsubscribe> {
  const { onAuthStateChanged } = await import("firebase/auth");
  const auth = await getFirebaseAuth();
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      onChange(null);
      return;
    }
    void resolvePlatformSession(user).then(onChange).catch(() => onChange(null));
  });
}

export async function signOutPlatform() {
  const { signOut } = await import("firebase/auth");
  const auth = await getFirebaseAuth();
  await signOut(auth);
}
