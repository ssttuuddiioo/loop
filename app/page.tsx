import { JournalField } from "@/components/JournalField";

export default function Home() {
  return (
    <main className="min-h-[100dvh] w-full flex items-center justify-center px-6 py-10">
      <div className="fixed top-6 left-6 text-bone/40 text-xs sm:text-sm select-none pointer-events-none">
        loop atl
      </div>
      <div className="fixed top-6 right-6 text-bone/40 text-xs sm:text-sm select-none pointer-events-none">
        current
      </div>
      <JournalField />
      <div className="fixed bottom-6 left-6 text-xs sm:text-sm">
        <a
          href="https://yopablo.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-royal hover:opacity-80 transition-opacity"
        >
          by yopablo
        </a>
      </div>
    </main>
  );
}
