export function CvPreview({ role, company }: { role: string; company?: string }) {
  const mobile = /flutter|mobile/i.test(role);
  const ai = /ai|agent/i.test(role);
  const projects = mobile
    ? ["Vitalink", "VITAL-TAG", "AreaHustle"]
    : ai
      ? ["ResolveAI", "DevAssist", "AreaHustle"]
      : ["SwapDesk", "AreaHustle", "ResolveAI"];
  return (
    <article className="cv-document" aria-label="Tailored resume preview">
      <header>
        <h2>Joshua Onyeka Ituma</h2>
        <p className="text-sm font-medium mt-1">{role}</p>
        <p className="cv-muted">Lagos, Nigeria · joshua@example.com · github.com/joshua</p>
      </header>
      <h3>Profile</h3>
      <p>
        Frontend and mobile engineer focused on accessible, thoughtful digital products{company ? `, applying for ${role} at ${company}` : ""}.
        Experienced with React, Next.js and Flutter, with a focus on maintainable user interfaces.
      </p>
      <h3>Core skills</h3>
      <p>
        {mobile
          ? "Flutter · Dart · Offline-first patterns · REST · Custom animations"
          : ai
            ? "React · Next.js · TypeScript · AI SDK · Streaming interfaces"
            : "React · Next.js · TypeScript · Tailwind CSS · Accessibility"}
      </p>
      <h3>Selected experience</h3>
      <p className="font-semibold">Frontend Engineer · BoukarTech Solutions Ltd</p>
      <ul>
        <li>Built reusable frontend interfaces with React and TypeScript.</li>
        <li>Collaborated on accessible UI and maintainable component patterns.</li>
      </ul>
      <p className="font-semibold mt-3">Frontend Engineer · Cavista Technologies</p>
      <ul>
        <li>Worked with product and engineering teams on user-facing features.</li>
      </ul>
      <h3>Selected projects</h3>
      {projects.map((p) => (
        <div key={p} className="mb-2">
          <p className="font-semibold">{p}</p>
          <p className="cv-muted">
            {p === "Vitalink"
              ? "Offline-first mobile health experience built with Flutter."
              : p === "ResolveAI"
                ? "Streaming AI support interface with transparent agent activity."
                : p === "SwapDesk"
                  ? "Reusable UI patterns and a thoughtful product experience."
                  : "Product project selected from the profile vault."}
          </p>
        </div>
      ))}
      <h3>Education & additional information</h3>
      <p>Available after a two-week notice period · Remote / Lagos / EMEA</p>
    </article>
  );
}
