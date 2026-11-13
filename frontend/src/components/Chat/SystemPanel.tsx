import { useState, useEffect, useCallback } from 'react';
import {
  Zap,
  Activity,
  Thermometer,
  TrendingDown,
  Cloud,
  HardDrive,
  Hash,
  X,
  Trophy,
  ExternalLink,
} from 'lucide-react';
import { useAppStore } from '../../lib/store';
import { getBase } from '../../lib/api';

interface EnergyData {
  total_energy_j?: number;
  energy_per_token_j?: number;
  avg_power_w?: number;
  cpu_temp_c?: number | null;
  gpu_temp_c?: number | null;
}

interface TelemetryStats {
  total_requests?: number;
  total_tokens?: number;
}

const CLOUD_PRICING = [
  { name: 'GPT-5.6 Sol', input: 5.00, output: 30.00, primary: true },
  { name: 'Claude Fable 5', input: 10.00, output: 50.00, primary: false },
  { name: 'Gemini 3.1 Pro', input: 2.00, output: 12.00, primary: false },
];

export function SystemPanel() {
  const savings = useAppStore((s) => s.savings);
  const toggleSystemPanel = useAppStore((s) => s.toggleSystemPanel);
  const optInEnabled = useAppStore((s) => s.optInEnabled);
  const setOptInModalOpen = useAppStore((s) => s.setOptInModalOpen);
  const liveEnergy = useAppStore((s) => s.liveEnergy);
  const [energy, setEnergy] = useState<EnergyData | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryStats | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const base = getBase();
      const [energyRes, telRes] = await Promise.allSettled([
        fetch(`${base}/v1/telemetry/energy`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${base}/v1/telemetry/stats`).then((r) => (r.ok ? r.json() : null)),
      ]);
      if (energyRes.status === 'fulfilled' && energyRes.value) {
        setEnergy(energyRes.value as EnergyData);
      }
      if (telRes.status === 'fulfilled' && telRes.value) {
        setTelemetry(telRes.value as TelemetryStats);
      }
    } catch {
      // best-effort
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Re-fetch energy/telemetry when savings updates (after a chat message)
  useEffect(() => {
    if (savings) fetchData();
  }, [savings, fetchData]);

  const promptK = (savings?.total_prompt_tokens ?? 0) / 1000;
  const completionK = (savings?.total_completion_tokens ?? 0) / 1000;

  const powerW = liveEnergy?.power_w ?? energy?.avg_power_w ?? 0;
  const energyKj = ((liveEnergy?.energy_j ?? energy?.total_energy_j ?? 0) / 1000);

  return (
    <div
      className="flex flex-col h-full overflow-y-auto"
      style={{
        width: 280,
        minWidth: 280,
        background: 'var(--color-bg)',
        borderLeft: '1px solid var(--color-border)',
      }}
    >
      {/* Header */}
      <div
        className="shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center justify-between pl-4 pr-11 pt-3.5 pb-2.5">
          <span className="hud-kicker" style={{ color: 'var(--color-text-secondary)' }}>
            System
          </span>
          <button
            onClick={toggleSystemPanel}
            className="p-1 transition-colors cursor-pointer"
            style={{ color: 'var(--color-text-tertiary)', borderRadius: 2 }}
            title="Close panel"
          >
            <X size={14} />
          </button>
        </div>
        <div className="hud-ticks mx-4 mb-2" aria-hidden="true" />
      </div>

      <div className="flex flex-col gap-5 p-4">
        {/* Session Stats */}
        <section>
          <h4 className="hud-kicker mb-2.5">Session</h4>
          <div className="grid grid-cols-2 gap-2">
            <MiniStat
              icon={Hash}
              label="Requests"
              value={String(savings?.total_calls ?? telemetry?.total_requests ?? 0)}
            />
            <MiniStat
              icon={Hash}
              label="Tokens"
              value={formatNumber(savings?.total_completion_tokens ?? telemetry?.total_tokens ?? 0)}
            />
          </div>
        </section>

        {/* Device */}
        <section>
          <h4 className="hud-kicker mb-2.5">Device</h4>
          <div className="grid grid-cols-2 gap-2">
            {energy?.cpu_temp_c != null && (
              <MiniStat icon={Thermometer} label="CPU" value={String(Math.round(energy.cpu_temp_c))} unit="°C" />
            )}
            {energy?.gpu_temp_c != null && (
              <MiniStat icon={Thermometer} label="GPU" value={String(Math.round(energy.gpu_temp_c))} unit="°C" />
            )}
            <MiniStat
              icon={Zap}
              label="Power"
              value={powerW.toFixed(1)}
              unit="W"
              meter={Math.min(powerW / 30, 1)}
            />
            <MiniStat
              icon={Activity}
              label="Energy"
              value={energyKj.toFixed(1)}
              unit="kJ"
              meter={Math.min(energyKj / 100, 1)}
            />
          </div>
        </section>

        {/* Cost Comparison */}
        <section>
          <h4 className="hud-kicker mb-2.5">Cost</h4>

          {/* Local */}
          <div className="hud-row hud-row-active flex items-center gap-2 px-2.5 py-2 mb-2">
            <HardDrive size={13} style={{ color: 'var(--color-accent)', flex: 'none' }} />
            <div className="flex-1 min-w-0">
              <div className="hud-mono-sm" style={{ color: 'var(--color-text-secondary)', letterSpacing: '0.1em' }}>
                LOCAL
              </div>
            </div>
            <div className="hud-num text-sm" style={{ color: 'var(--color-success)' }}>
              ${(savings?.local_cost ?? 0).toFixed(4)}
            </div>
          </div>

          {/* Cloud providers */}
          <div className="flex flex-col gap-1.5">
            {CLOUD_PRICING.map((provider) => {
              const cost = (promptK * provider.input) / 1000 + (completionK * provider.output) / 1000;
              const saved = cost - (savings?.local_cost ?? 0);
              return (
                <div
                  key={provider.name}
                  className="hud-row flex items-center gap-2 px-2.5 py-2"
                >
                  <Cloud size={13} style={{ color: 'var(--color-text-tertiary)', flex: 'none' }} />
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-[11px] truncate"
                      style={{
                        color: provider.primary ? 'var(--color-text)' : 'var(--color-text-secondary)',
                        letterSpacing: '0.02em',
                      }}
                    >
                      {provider.name}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="hud-num text-[11px]" style={{ color: 'var(--color-text)' }}>
                      ${cost.toFixed(4)}
                    </div>
                    {saved > 0.0001 && (
                      <div
                        className="hud-mono-sm flex items-center gap-0.5 justify-end"
                        style={{ color: 'var(--color-success)', fontSize: 9 }}
                      >
                        <TrendingDown size={8} />
                        ${saved.toFixed(4)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Leaderboard / Share */}
        <section>
          <h4 className="hud-kicker mb-2.5">Leaderboard</h4>

          <button
            onClick={() => setOptInModalOpen(true)}
            className="hud-row hud-corners w-full flex items-center gap-2 px-2.5 py-2.5 transition-colors cursor-pointer"
            style={{
              background: optInEnabled
                ? 'color-mix(in srgb, var(--color-accent) 8%, var(--color-bg-secondary))'
                : undefined,
              borderColor: optInEnabled
                ? 'color-mix(in srgb, var(--color-accent) 45%, transparent)'
                : undefined,
            }}
          >
            <Trophy
              size={13}
              style={{
                color: optInEnabled ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
                flex: 'none',
              }}
            />
            <span
              className="hud-mono-sm flex-1 text-left"
              style={{
                color: optInEnabled ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                letterSpacing: '0.06em',
              }}
            >
              {optInEnabled ? 'SHARING' : 'SHARE SAVINGS'}
            </span>
            <span
              className="hud-mono-sm"
              style={{
                fontSize: 9,
                padding: '1px 5px',
                borderRadius: 2,
                letterSpacing: '0.12em',
                background: optInEnabled ? 'var(--color-accent)' : 'transparent',
                border: optInEnabled ? 'none' : '1px solid var(--color-border)',
                color: optInEnabled ? 'var(--color-on-accent)' : 'var(--color-text-tertiary)',
              }}
            >
              {optInEnabled ? 'ON' : 'OFF'}
            </span>
          </button>

          <a
            href="https://open-jarvis.github.io/OpenJarvis/leaderboard"
            target="_blank"
            rel="noopener noreferrer"
            className="hud-mono-sm flex items-center gap-1.5 mt-2 px-1 py-1 transition-colors"
            style={{ color: 'var(--color-text-tertiary)', letterSpacing: '0.06em' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-accent)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-tertiary)')}
          >
            <ExternalLink size={9} />
            OPEN LEADERBOARD
          </a>
        </section>
      </div>
    </div>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
  unit,
  meter,
}: {
  icon: typeof Zap;
  label: string;
  value: string;
  unit?: string;
  /** Optional 0..1 fill for the scale bar. Presentation only. */
  meter?: number;
}) {
  return (
    <div className="hud-row px-2.5 pt-2 pb-1.5">
      <div className="flex items-center gap-1 mb-1">
        <Icon size={9} style={{ color: 'var(--color-accent)', flex: 'none' }} />
        <span
          className="hud-mono-sm truncate"
          style={{ color: 'var(--color-text-tertiary)', fontSize: 9, letterSpacing: '0.1em' }}
        >
          {label.toUpperCase()}
        </span>
      </div>
      <div className="hud-num text-[15px] leading-none" style={{ color: 'var(--color-text)' }}>
        {value}
        {unit && (
          <span
            className="hud-mono-sm"
            style={{ color: 'var(--color-text-tertiary)', marginLeft: 2, fontSize: 9 }}
          >
            {unit}
          </span>
        )}
      </div>
      {/* scale bar — the row reads as an instrument, not a stat card */}
      <div
        className="mt-1.5 overflow-hidden"
        style={{ height: 2, background: 'var(--hud-line-dim)' }}
        aria-hidden="true"
      >
        <div
          style={{
            width: `${Math.round((meter ?? 0) * 100)}%`,
            height: '100%',
            background: 'var(--color-accent)',
            boxShadow: '0 0 6px var(--color-accent-glow)',
            transition: 'width 500ms ease',
          }}
        />
      </div>
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}
