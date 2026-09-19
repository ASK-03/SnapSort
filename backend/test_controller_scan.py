"""Self-check: scan_folder picks up all supported image formats, skips others."""
import os
import tempfile

from controller import Controller


def demo():
    exts_supported = Controller.SUPPORTED_EXTENSIONS
    unsupported = (".txt", ".mp4", ".psd")

    with tempfile.TemporaryDirectory() as d:
        for ext in exts_supported:
            open(os.path.join(d, f"photo{ext}"), "wb").close()
        for ext in unsupported:
            open(os.path.join(d, f"other{ext}"), "wb").close()

        found = []
        for root, _, files in os.walk(d):
            for fn in files:
                if fn.lower().endswith(exts_supported):
                    found.append(fn)

        assert len(found) == len(exts_supported), f"expected {len(exts_supported)}, got {len(found)}"
        for ext in unsupported:
            assert not any(f.endswith(ext) for f in found), f"{ext} should be excluded"

    print("ok:", exts_supported)


if __name__ == "__main__":
    demo()
