import { useState } from "react";
import { FileText, MessageSquareText, Printer } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { CvPreview } from "@/components/cv-preview";

export interface Artifact {
  company: string;
  role: string;
  coverLetter?: string;
  answers?: { q: string; a: string }[];
  appliedAt?: string;
}
export function ArtifactDrawer({
  artifact,
  onClose,
  initialTab = "cv",
}: {
  artifact: Artifact | null;
  onClose: () => void;
  initialTab?: "cv" | "answers";
}) {
  const [tab, setTab] = useState(initialTab);
  return (
    <Sheet
      open={Boolean(artifact)}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent className="artifact-sheet bg-background">
        {artifact && (
          <>
            <SheetHeader className="artifact-header text-left pr-10">
              <SheetTitle className="font-display text-3xl font-normal">{artifact.company}</SheetTitle>
              <SheetDescription>
                {artifact.role}
                {artifact.appliedAt
                  ? ` · sent ${new Date(artifact.appliedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`
                  : " · ready for review"}
              </SheetDescription>
            </SheetHeader>
            <div className="artifact-toolbar flex flex-wrap gap-2">
              <Button variant={tab === "cv" ? "soft" : "ghost"} onClick={() => setTab("cv")}>
                <FileText />
                CV
              </Button>
              <Button variant={tab === "answers" ? "soft" : "ghost"} onClick={() => setTab("answers")}>
                <MessageSquareText />
                Letter & answers
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto"
                title="Print or save as PDF"
                aria-label="Print or save as PDF"
                onClick={() => window.print()}
              >
                <Printer />
              </Button>
            </div>
            <div className="artifact-scroll">
              <div className="print-artifact">
                {tab === "cv" ? (
                  <CvPreview role={artifact.role} company={artifact.company} />
                ) : (
                  <div className="space-y-6">
                    <section>
                      <h3 className="ui-title mb-3">Cover letter sent</h3>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">{artifact.coverLetter ?? "No cover letter attached."}</p>
                    </section>
                    <section>
                      <h3 className="ui-title mb-3">Screening answers</h3>
                      {artifact.answers?.map((a) => (
                        <div key={a.q} className="border-t border-border py-3">
                          <p className="font-medium text-sm">{a.q}</p>
                          <p className="mt-1 text-sm text-muted-foreground">{a.a}</p>
                        </div>
                      ))}
                    </section>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
