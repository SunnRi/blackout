import { useEffect, useRef, useState } from 'react';
import { Clock, History, Plus, Settings, Zap } from 'lucide-react';
import { hapticImpact } from '@/lib/telegram';
import { type View } from '@/types';
type TourStep = {
  icon: typeof Zap;
  title: string;
  text: string;
  accent: string;
  target: string;
  view?: View;
};

const TOUR_STEPS: TourStep[] = [
  {
    icon: Zap,
    title: 'Статус світла',
    text: 'Ця картка завжди показує, чи є світло зараз, і коли включать або відключать наступного разу.',
    accent: 'from-emerald-500 to-teal-500',
    target: '[data-tour="status"]',
  },
  {
    icon: Clock,
    title: 'Графік на день',
    text: 'Тут показані всі години доби: зелені — світло є, червоні — відключення. Перемикайтеся між «Сьогодні» і «Завтра».',
    accent: 'from-blue-500 to-cyan-500',
    target: '[data-tour="daytabs"],[data-tour="graph"]',
  },
  {
    icon: History,
    title: 'Оновлення графіка',
    text: 'Ця кнопка відкриває історію змін. Коли енергетики змінюють графік — побачите що саме змінилося. Про зміни повідомить і Telegram-бот.',
    accent: 'from-amber-500 to-orange-500',
    target: '[data-tour="history"]',
  },
  {
    icon: Settings,
    title: 'Налаштування',
    text: 'Тут обирають область, місто і чергу, тему оформлення та сповіщення. Усе синхронізується з ботом.',
    accent: 'from-slate-500 to-slate-600',
    target: '[data-tour="settings"]',
  },
  {
    icon: Plus,
    title: 'Друга локація',
    text: 'У налаштуваннях можна додати другу локацію — наприклад, роботу — і дати вкладці своє ім\u2019я. Між адресами перемикайтеся вкладками на головному екрані.',
    accent: 'from-violet-500 to-fuchsia-500',
    target: '[data-tour="alt-location"]',
    view: 'settings',
  },
];

function GuidedTour({ onDone, onSkip, goToView }: { onDone: () => void; onSkip: () => void; goToView: (v: View) => void }) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [cardPos, setCardPos] = useState<{ top: number; left: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const s = TOUR_STEPS[step];
  const Icon = s.icon;
  const isLast = step === TOUR_STEPS.length - 1;

  // Find and highlight the real element for this step. Steps may switch views
  // first (e.g. the second-location step lands in settings), so measure after
  // the view has rendered.
  useEffect(() => {
    if (s.view) goToView(s.view);
    let raf = 0;
    const measure = () => {
      const el = document.querySelector(s.target) as HTMLElement | null;
      if (!el) { setRect(null); setCardPos(null); return; }
      el.scrollIntoView({ block: 'center' });
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      });
    };
    const t = setTimeout(measure, 80);
    window.addEventListener('resize', measure);
    return () => { clearTimeout(t); cancelAnimationFrame(raf); window.removeEventListener('resize', measure); };
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Anchor the tooltip next to the highlighted element, clamped to the screen.
  useEffect(() => {
    if (!rect) { setCardPos(null); return; }
    const viewportWidth = window.visualViewport?.width ?? document.documentElement.clientWidth;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const cw = cardRef.current?.offsetWidth ?? Math.min(380, viewportWidth - 24);
    const ch = cardRef.current?.offsetHeight ?? 280;
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - cw / 2), Math.max(12, viewportWidth - cw - 12));
    const fitsBelow = rect.top + rect.height + 12 + ch <= viewportHeight - 12;
    const preferredTop = fitsBelow ? rect.top + rect.height + 12 : rect.top - ch - 12;
    const top = Math.min(Math.max(12, preferredTop), Math.max(12, viewportHeight - ch - 12));
    setCardPos({ top, left });
  }, [rect, step]);

  return (
    <div
      className="fixed inset-0 z-[60]"
      style={{ background: rect ? 'transparent' : 'rgba(0,0,0,0.45)' }}
      onClick={isLast ? onDone : undefined}
    >
      {rect && (
        <div
          className="tour-spotlight fixed z-[61]"
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
        />
      )}
      <div
        ref={cardRef}
        className="fixed z-[62] box-border max-h-[calc(100vh-24px)] overflow-y-auto rounded-3xl border border-white/15 p-6 shadow-2xl fade-in-up"
        style={{
          width: 'min(380px, calc(100vw - 24px))',
          maxWidth: 'calc(100vw - 24px)',
          boxSizing: 'border-box',
          background: 'color-mix(in srgb, var(--bg-card, #ffffff) 92%, transparent)',
          ...(cardPos
            ? { top: cardPos.top, left: cardPos.left }
            : { bottom: 40, left: '50%', transform: 'translateX(-50%)' }),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br ${s.accent} shadow-lg`}>
          <Icon className="h-8 w-8 text-white" />
        </div>
        <p className="mb-1 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-c">
          Крок {step + 1} з {TOUR_STEPS.length}
        </p>
        <h3 className="mb-2 text-center text-lg font-bold text-primary-c">{s.title}</h3>
        <p className="mb-5 text-center text-sm leading-relaxed text-secondary-c">{s.text}</p>
        <div className="mb-4 flex justify-center gap-1.5">
          {TOUR_STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? 'w-5 accent-bg' : 'w-1.5 bg-black/15 dark:bg-white/20'}`}
            />
          ))}
        </div>
        <div className="flex gap-2">
          {!isLast && (
            <button
              onClick={onSkip}
              className="d-btn rounded-xl px-4 py-3 text-sm font-medium text-secondary-c"
            >Пропустити</button>
          )}
          <button
            onClick={() => { if (isLast) { onDone(); } else { setStep(step + 1); } hapticImpact('light'); }}
            className="flex-1 rounded-xl accent-bg px-4 py-3 text-sm font-bold text-white transition-all hover:scale-[1.02]"
          >
            {isLast ? 'Почнемо!' : 'Далі'}
          </button>
        </div>
      </div>
    </div>
  );
}
export default GuidedTour;