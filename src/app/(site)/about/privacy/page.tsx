export const metadata = { title: "Privacy & children" };
export default function Page() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-12 text-bone-2">
      <h1 className="mv-display text-5xl text-bone">Privacy &amp; children</h1>
      <p>This local release stores data in your own database. Passwords are hashed with Argon2id; sessions use HTTP-only cookies; IP addresses are only stored as salted hashes in audit logs.</p>
      <h2 className="mv-display pt-4 text-2xl text-bone">Camera &amp; virtual trial room</h2>
      <p>Pose tracking runs entirely in your browser. Camera frames are never uploaded or recorded. You can stop the camera at any time.</p>
      <h2 className="mv-display pt-4 text-2xl text-bone">Children</h2>
      <p>Child profiles are guardian-managed: a nickname and birth year only, with explicit guardian consent. Children cannot sign in, pay or purchase. Their measurements and designs are private and never shared publicly by default. Deleting a child profile deletes its measurements and avatars.</p>
      <h2 className="mv-display pt-4 text-2xl text-bone">Your rights</h2>
      <p>You can edit your profile, export design data (tech pack JSON) and delete your account at any time from Account → Settings. Before a production launch, the operator must review applicable Indian law (including the Digital Personal Data Protection Act, 2023 and its rules on children&apos;s data).</p>
    </div>
  );
}
