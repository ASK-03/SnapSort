"""
One-time model downloader for SnapSort.
Run: python3 scripts/download_models.py

Downloads to: SnapSort/models/
  face_detection_yunet_2023mar.onnx     ~375KB  (OpenCV Zoo)
  face_recognition_sface_2021dec.onnx   ~37MB   (OpenCV Zoo)
  clip_visual_quantized.onnx            ~86MB   (Xenova/clip-vit-base-patch32)
  clip_text_quantized.onnx              ~31MB   (Xenova/clip-vit-base-patch32)
"""
import os
import urllib.request
import sys

MODELS_DIR = os.path.join(os.path.dirname(__file__), "..", "models")
os.makedirs(MODELS_DIR, exist_ok=True)

MODELS = {
    "face_detection_yunet_2023mar.onnx": (
        "https://github.com/opencv/opencv_zoo/raw/main/models/"
        "face_detection_yunet/face_detection_yunet_2023mar.onnx"
    ),
    "face_recognition_sface_2021dec.onnx": (
        "https://github.com/opencv/opencv_zoo/raw/main/models/"
        "face_recognition_sface/face_recognition_sface_2021dec.onnx"
    ),
    "clip_visual_quantized.onnx": (
        "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/"
        "onnx/vision_model_quantized.onnx"
    ),
    "clip_text_quantized.onnx": (
        "https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/"
        "onnx/text_model_quantized.onnx"
    ),
}


def _reporthook(count, block_size, total_size):
    downloaded = count * block_size
    if total_size > 0:
        pct = min(downloaded * 100 / total_size, 100)
        mb = downloaded / 1_048_576
        total_mb = total_size / 1_048_576
        print(f"\r  {pct:5.1f}%  {mb:.1f}/{total_mb:.1f} MB", end="", flush=True)


def download_all(force=False):
    for filename, url in MODELS.items():
        dest = os.path.join(MODELS_DIR, filename)
        if os.path.exists(dest) and not force:
            print(f"[skip] {filename} already present")
            continue
        print(f"[download] {filename}")
        urllib.request.urlretrieve(url, dest, reporthook=_reporthook)
        print()
    print("All models ready.")


if __name__ == "__main__":
    force = "--force" in sys.argv
    download_all(force=force)
