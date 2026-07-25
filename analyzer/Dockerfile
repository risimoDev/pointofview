# CUDA build (RTX 3080). For CPU-only:
#   docker build --build-arg BASE_IMAGE=python:3.12-slim \
#                --build-arg TORCH_VARIANT=cpu --build-arg INSTALL_PYTHON=0 .
ARG BASE_IMAGE=nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04
FROM ${BASE_IMAGE}

ARG TORCH_VARIANT=cu124       # cu124 | cpu
ARG INSTALL_PYTHON=1          # 1 on CUDA/ubuntu base, 0 on python:* base
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# OpenCV/FFmpeg runtime libs; Python 3.12 via deadsnakes on ubuntu base
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl ffmpeg libgl1 libglib2.0-0 && \
    if [ "$INSTALL_PYTHON" = "1" ]; then \
        apt-get install -y --no-install-recommends software-properties-common && \
        add-apt-repository -y ppa:deadsnakes/ppa && apt-get update && \
        apt-get install -y --no-install-recommends python3.12 python3.12-dev && \
        curl -sS https://bootstrap.pypa.io/get-pip.py | python3.12 ; \
    fi && \
    rm -rf /var/lib/apt/lists/*

# `python` → 3.12 regardless of base
RUN ln -sf "$(command -v python3.12 || command -v python3)" /usr/local/bin/python

WORKDIR /app
COPY requirements.txt .
# torchvision is installed here, from the CUDA channel, even though nothing in
# requirements.txt needs it: rfdetr does, and letting pip pull it later from
# PyPI would drag a CPU-built torch along with it.
RUN python -m pip install --upgrade pip && \
    python -m pip install torch torchvision --index-url "https://download.pytorch.org/whl/${TORCH_VARIANT}" && \
    python -m pip install -r requirements.txt

# RF-DETR (Apache-2.0) — the licence-clean detector. Installed separately and
# defensively: it declares its own torch/torchvision requirement, and a plain
# `pip install` resolves that against PyPI, which would silently replace the
# CUDA wheels above with CPU builds.
#
# The constraint file carries PUBLIC versions only (torch==2.13.0, not
# 2.13.0+cu130): a local version tag is resolvable only from the index that
# hosts that exact build, so pinning it makes the install unsatisfiable.
# Without the tag the installed CUDA wheel satisfies the requirement and pip
# leaves it alone. The check afterwards tests the property that actually
# matters — that this is still a CUDA build — not a version string.
ARG WITH_RFDETR=1
RUN if [ "$WITH_RFDETR" = "1" ]; then \
      python -c "import torch, torchvision; print('torch==' + torch.__version__.split('+')[0]); print('torchvision==' + torchvision.__version__.split('+')[0])" > /tmp/pins.txt && \
      cat /tmp/pins.txt && \
      python -m pip install -c /tmp/pins.txt rfdetr==1.3.* \
          --extra-index-url "https://download.pytorch.org/whl/${TORCH_VARIANT}" && \
      if [ "$TORCH_VARIANT" != "cpu" ]; then \
        python -c "import torch, sys; sys.exit('FATAL: the rfdetr install replaced torch with a CPU build') if torch.version.cuda is None else print('torch ok:', torch.__version__, 'cuda', torch.version.cuda)" ; \
      fi ; \
    fi

# Bake the RF-DETR checkpoint into the image so a first start needs no
# internet. The package downloads on first construction; whatever file that
# produces is copied to a stable path. Non-fatal: without it the first start
# downloads once (and the /root/.cache volume then keeps it).
RUN if [ "$WITH_RFDETR" = "1" ]; then \
      mkdir -p /opt/models && \
      (python -c "from rfdetr import RFDETRSmall; RFDETRSmall()" >/dev/null 2>&1 || true) && \
      W="$(find / -xdev -iname '*rf*detr*.pth' 2>/dev/null | head -1)" && \
      if [ -n "$W" ]; then cp "$W" /opt/models/rfdetr_small.pth && \
          echo "RF-DETR weights baked from $W"; \
      else echo "WARN: RF-DETR weights not baked — first start needs internet"; fi ; \
    fi

# staff face-id models (YuNet + SFace, ~40MB total). media.githubusercontent
# resolves git-lfs binaries. Failure only disables face-id at runtime.
RUN mkdir -p /opt/models && \
    (curl -fsSL -o /opt/models/face_detection_yunet.onnx \
        https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx && \
     curl -fsSL -o /opt/models/face_recognition_sface.onnx \
        https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx) \
    || echo "WARN: face models download failed — staff face-id will be disabled"

# pose model (fall detection plugin, ~7MB) baked in so prod needs no internet
# at runtime. Two release tags tried; on failure the plugin falls back to the
# /models mount and then to a runtime auto-download.
RUN (curl -fsSL --retry 3 -o /opt/models/yolov8n-pose.pt \
        https://github.com/ultralytics/assets/releases/download/v8.2.0/yolov8n-pose.pt \
     || curl -fsSL --retry 3 -o /opt/models/yolov8n-pose.pt \
        https://github.com/ultralytics/assets/releases/download/v0.0.0/yolov8n-pose.pt) \
    || echo "WARN: pose model download failed — plugin will use /models or auto-download"
ENV POSE_MODEL=/opt/models/yolov8n-pose.pt

# main detector weights baked in for offline (air-gapped) installs — with a
# bare name in YOLO_MODEL ultralytics would try to download at startup. Online
# deployments may still override YOLO_MODEL with a bare name (cache volume).
RUN for M in yolov8n.pt yolov8s.pt; do \
      (curl -fsSL --retry 3 -o /opt/models/$M \
          https://github.com/ultralytics/assets/releases/download/v8.2.0/$M \
       || curl -fsSL --retry 3 -o /opt/models/$M \
          https://github.com/ultralytics/assets/releases/download/v0.0.0/$M) \
      || echo "WARN: $M download failed — offline install will need /models/$M"; \
    done

COPY . /app/analyzer
ENV PYTHONPATH=/app \
    ANALYZER_DEVICE=cuda

CMD ["python", "-m", "analyzer.detect.worker"]
