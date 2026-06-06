import { WindScene } from "@/components/WindScene";

export default function WindPage() {
  return (
    <main className="fixed inset-0 overflow-hidden bg-ink">
      <WindScene />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/qr.png"
        alt="QR code"
        width={107}
        height={107}
        className="fixed bottom-6 right-6 z-10 h-[96px] w-[96px] select-none sm:h-[107px] sm:w-[107px]"
        draggable={false}
      />
    </main>
  );
}
