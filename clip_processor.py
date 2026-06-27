"""
CLIP image/text embedding via Xenova quantized ONNX models (ViT-B/32).

  clip_visual_quantized.onnx  ~86MB   input: pixel_values (B,3,224,224)  output: image_embeds (B,512)
  clip_text_quantized.onnx    ~31MB   input: input_ids    (B,77)          output: text_embeds  (B,512)

Both outputs are ALREADY L2-normalised by the model — dot product == cosine similarity.
"""
import os
import numpy as np
import onnxruntime as ort
import logging
from PIL import Image

logger = logging.getLogger(__name__)

_CLIP_MEAN = np.array([0.48145466, 0.4578275,  0.40821073], dtype=np.float32)
_CLIP_STD  = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)
_MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")


def _make_session(filename: str) -> ort.InferenceSession:
    path = os.path.join(_MODELS_DIR, filename)
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"CLIP model not found: {path}\nRun:  python3 scripts/download_models.py"
        )
    opts = ort.SessionOptions()
    opts.inter_op_num_threads = 2
    opts.intra_op_num_threads = 2
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return ort.InferenceSession(path, sess_options=opts, providers=["CPUExecutionProvider"])


class CLIPProcessor:
    """
    Thread-compatible CLIP wrapper. Create one instance per worker process.
    Sessions are lazily loaded on first use to keep startup fast.
    """

    def __init__(self):
        self._vis  = None
        self._text = None
        self._tok  = None

    def _vis_session(self) -> ort.InferenceSession:
        if self._vis is None:
            self._vis = _make_session("clip_visual_quantized.onnx")
            logger.info("CLIP visual ONNX session ready")
        return self._vis

    def _text_session(self) -> ort.InferenceSession:
        if self._text is None:
            self._text = _make_session("clip_text_quantized.onnx")
            logger.info("CLIP text ONNX session ready")
        return self._text

    def _tokenizer(self):
        if self._tok is None:
            from transformers import CLIPTokenizerFast
            tok_dir = os.path.join(_MODELS_DIR, "clip_tokenizer")
            if os.path.isdir(tok_dir):
                self._tok = CLIPTokenizerFast.from_pretrained(tok_dir, local_files_only=True)
            else:
                logger.info("Downloading CLIP tokenizer (~2 MB)…")
                self._tok = CLIPTokenizerFast.from_pretrained("openai/clip-vit-base-patch32")
                self._tok.save_pretrained(tok_dir)
                logger.info("CLIP tokenizer cached at %s", tok_dir)
        return self._tok

    # ------------------------------------------------------------------
    def embed_image(self, path: str) -> np.ndarray:
        """Return L2-normalised 512-d embedding for an image file."""
        img = Image.open(path).convert("RGB").resize((224, 224), Image.BICUBIC)
        arr = np.array(img, dtype=np.float32) / 255.0
        arr = (arr - _CLIP_MEAN) / _CLIP_STD
        pixel_values = arr.transpose(2, 0, 1)[np.newaxis, ...]   # (1, 3, 224, 224)
        emb = self._vis_session().run(["image_embeds"], {"pixel_values": pixel_values})[0][0]
        emb = emb.astype("float32")
        n = np.linalg.norm(emb)
        return emb / n if n > 0 else emb

    def embed_text(self, text: str) -> np.ndarray:
        """Return L2-normalised 512-d embedding for a text query."""
        enc = self._tokenizer()(
            [text],
            return_tensors="np",
            padding="max_length",
            max_length=77,
            truncation=True,
        )
        input_ids = enc["input_ids"].astype(np.int64)
        emb = self._text_session().run(["text_embeds"], {"input_ids": input_ids})[0][0]
        emb = emb.astype("float32")
        n = np.linalg.norm(emb)
        return emb / n if n > 0 else emb
