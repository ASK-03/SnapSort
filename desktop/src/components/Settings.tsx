import { useAppStore } from '../store';
import { Cpu } from 'lucide-react';

const ActiveBadge = () => (
  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-hi border border-border text-xs font-medium text-success shrink-0">
    <span className="w-1.5 h-1.5 rounded-full bg-success" aria-hidden="true" />
    Local · Active
  </span>
);

export const Settings = () => {
  const { viewMode } = useAppStore();

  if (viewMode !== 'settings') return null;

  return (
    <div className="flex-1 flex flex-col bg-bg text-text h-full overflow-y-auto p-8">
      <div className="max-w-3xl w-full mx-auto">
        <h1 className="text-2xl font-semibold tracking-tight mb-6 text-text">Settings</h1>

        <div className="space-y-6">
          <section className="bg-surface border border-border rounded-xl p-6">
            <div className="flex items-center gap-2.5 mb-4">
              <Cpu size={18} className="text-accent" aria-hidden="true" />
              <h2 className="text-base font-semibold text-text">Indexing & AI</h2>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-text font-medium text-sm">Face Recognition</h3>
                  <p className="text-xs text-text-mute mt-1">
                    Automatically group similar faces locally using YuNet and SFace.
                  </p>
                </div>
                <ActiveBadge />
              </div>

              <div className="border-t border-border pt-4 flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-text font-medium text-sm">CLIP Semantic Search</h3>
                  <p className="text-xs text-text-mute mt-1">OpenAI ViT-B/32 quantized ONNX model running locally.</p>
                </div>
                <ActiveBadge />
              </div>
            </div>
          </section>

          <section className="bg-surface border border-border rounded-xl p-6">
            <h2 className="text-base font-semibold text-text mb-4">Support</h2>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-text font-medium text-sm">Report a Bug</h3>
                <p className="text-xs text-text-mute mt-1">Found an issue? Let us know on GitHub.</p>
              </div>
              <a
                href="https://github.com/ASK-03/SnapSort/issues/new"
                target="_blank"
                rel="noopener noreferrer"
                className="pressable bg-surface-hi border border-border text-text hover:bg-bg px-4 py-2 rounded-lg text-xs font-medium shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Open GitHub Issue
              </a>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
