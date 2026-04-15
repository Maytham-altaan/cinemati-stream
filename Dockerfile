FROM node:20-slim

# Install Python, pip, yt-dlp, and make node accessible for yt-dlp JS challenges
RUN apt-get update && apt-get install -y python3 python3-pip curl && \
    pip3 install --break-system-packages yt-dlp --upgrade && \
    pip3 install --break-system-packages bgutil-ytdlp-pot-provider && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Ensure node is available system-wide for yt-dlp JS challenge solving
RUN ln -sf /usr/local/bin/node /usr/bin/node 2>/dev/null || true

WORKDIR /app
COPY package.json .
RUN npm install --production
COPY server.js .

EXPOSE 3001
ENV PORT=3001
CMD ["node", "server.js"]
