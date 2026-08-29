# NovaPay V6.0 — Dockerfile for Railway (with Chinese mirror)
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080 \
    PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple \
    PIP_TRUSTED_HOST=pypi.tuna.tsinghua.edu.cn

WORKDIR /app

# 系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Python 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 应用代码
COPY . .

# 持久化数据目录
RUN mkdir -p /data && chmod 777 /data

EXPOSE 8080

CMD ["sh", "-c", "mkdir -p /data && exec gunicorn run:app -b 0.0.0.0:$PORT --workers 2 --timeout 120"]
