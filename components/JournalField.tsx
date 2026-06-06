"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pickRandom } from "@/lib/palette";

type Phase = "field" | "thanks";

export function JournalField() {
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("field");
  const [color, setColor] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Pick a palette color per load, client-side (avoids SSR hydration mismatch).
  useEffect(() => {
    setColor(pickRandom().hex);
  }, []);

  useEffect(() => {
    if (phase === "field") taRef.current?.focus();
  }, [phase]);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [text, phase]);

  const submit = useCallback(async () => {
    const value = text.trim();
    if (!value) return;
    fetch("/api/release", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: value, color }),
    }).catch(() => {});
    setPhase("thanks");
    window.setTimeout(() => {
      setText("");
      setPhase("field");
    }, 3000);
  }, [text, color]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="w-full max-w-md mx-auto relative">
      <div
        className={`transition-opacity duration-700 ease-out ${
          phase === "field" ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <p className="text-bone/50 text-sm sm:text-[15px] mb-5 leading-snug select-none">
          what do you want to let go of?
        </p>
        <div
          className="relative text-base sm:text-lg leading-snug"
          onClick={() => taRef.current?.focus()}
        >
          <div
            aria-hidden
            className="whitespace-pre-wrap break-words min-h-[1.5em]"
            style={{ color: color ?? undefined }}
          >
            {text}
            <span className="blink-cursor">█</span>
          </div>
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            maxLength={280}
            disabled={phase !== "field"}
            aria-label="what do you want to let go of?"
            className="absolute inset-0 w-full h-full resize-none bg-transparent outline-none border-0 p-0 leading-snug overflow-hidden"
            style={{
              color: "transparent",
              caretColor: "transparent",
              WebkitTextFillColor: "transparent",
              font: "inherit",
            }}
          />
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim() || phase !== "field"}
          style={text.trim() ? { color: color ?? undefined } : undefined}
          className="mt-5 text-sm sm:text-base text-royal hover:opacity-80 transition-opacity disabled:text-bone/25 disabled:cursor-default"
        >
          release ↵
        </button>
      </div>
      <div
        aria-hidden={phase !== "thanks"}
        className={`absolute inset-0 flex items-start transition-opacity duration-700 ease-out ${
          phase === "thanks" ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <p className="text-bone/70 text-base sm:text-lg">thanks.</p>
      </div>
    </div>
  );
}
