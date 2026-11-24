/**
 * Navigation feedback while the project read is in flight. Mirrors the editor's
 * panel geometry so the page does not jump when the real editor replaces it.
 */
export default function EditorLoading() {
  return (
    <div
      className="grid h-dvh grid-rows-[3rem_minmax(0,1fr)_38%] overflow-hidden"
      aria-busy="true"
      aria-label="Loading editor"
    >
      <div className="flex items-center gap-3 border-b px-3">
        <div className="bg-muted h-7 w-7 animate-pulse rounded-md" />
        <div className="space-y-1.5">
          <div className="bg-muted h-2 w-14 animate-pulse rounded" />
          <div className="bg-muted h-3 w-48 animate-pulse rounded" />
        </div>
      </div>

      <div className="grid min-h-0 grid-cols-[16rem_minmax(0,1fr)_18rem]">
        <div className="border-r p-3">
          <div className="bg-muted h-3 w-16 animate-pulse rounded" />
        </div>
        <div className="flex items-center justify-center p-6">
          <div className="bg-muted/60 aspect-video w-full max-w-2xl animate-pulse rounded-lg" />
        </div>
        <div className="border-l p-3">
          <div className="bg-muted h-3 w-20 animate-pulse rounded" />
        </div>
      </div>

      <div className="border-t p-3">
        <div className="bg-muted mb-3 h-3 w-24 animate-pulse rounded" />
        <div className="bg-muted/60 h-16 animate-pulse rounded-lg" />
      </div>
    </div>
  );
}
