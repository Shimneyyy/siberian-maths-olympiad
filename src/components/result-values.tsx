import { cn } from "@/lib/utils";

const prizeStyles = new Map([
  ["золото", "border-amber-300 bg-amber-100 text-amber-950"],
  ["серебро", "border-slate-300 bg-slate-100 text-slate-800"],
  ["бронза", "border-orange-300 bg-orange-100 text-orange-950"],
]);

export function ResultPrize({ prize }: { prize: string | null }) {
  if (!prize) return "—";
  const style = prizeStyles.get(prize.trim().toLocaleLowerCase("ru"));
  if (!style) return prize;
  return <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-sm font-semibold", style)}>{prize}</span>;
}

export function ResultScores({ scores }: { scores: { ordinal: number; score: number | null }[] }) {
  if (!scores.length) return "—";
  return <dl className="flex flex-wrap gap-1.5">
    {scores.map(({ ordinal, score }) => <div key={ordinal} className="min-w-12 overflow-hidden rounded-md border border-border text-center">
      <dt className="bg-muted px-1.5 py-0.5 text-xs text-slate-600">Задача {ordinal}</dt>
      <dd className="px-1.5 py-0.5 font-medium tabular-nums">{score ?? "—"}</dd>
    </div>)}
  </dl>;
}
