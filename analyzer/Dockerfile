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
RUN python -m pip install --upgrade pip && \
    python -m pip install torch --index-url "https://download.pytorch.org/whl/${TORCH_VARIANT}" && \
    python -m pip install -r requirements.txt

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
