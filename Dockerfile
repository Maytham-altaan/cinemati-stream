FROM node:20-slim

# Install Python, pip, and yt-dlp (latest nightly for best YouTube compatibility)
RUN apt-get update && apt-get install -y python3 python3-pip curl && \
    pip3 install --break-system-packages yt-dlp --upgrade && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json .
RUN npm install --production
COPY server.js .

EXPOSE 3001
ENV PORT=3001
CMD ["node", "server.js"]
