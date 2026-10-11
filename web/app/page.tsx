import { FredMark } from "@/components/fred-mark";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <FredMark working className="h-13 w-10" />
      <h1 className="text-3xl font-semibold tracking-tight">Fred</h1>
      <p className="max-w-sm text-muted-foreground">
        The new app is on its way. The inbox, the listing modal and the chat come next.
      </p>
    </main>
  );
}
