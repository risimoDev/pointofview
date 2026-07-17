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
# at runtime. Failure only disables the pose feature.
RUN (curl -fsSL -o /opt/models/yolov8n-pose.pt \
        https://github.com/ultralytics/assets/releases/download/v8.2.0/yolov8n-pose.pt) \
    || echo "WARN: pose model download failed — fall detection will be disabled"
ENV POSE_MODEL=/opt/models/yolov8n-pose.pt

COPY . /app/analyzer
ENV PYTHONPATH=/app \
    ANALYZER_DEVICE=cuda

CMD ["python", "-m", "analyzer.detect.worker"]
