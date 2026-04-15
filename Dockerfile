FROM node:20-slim

# Install Python, pip, git, yt-dlp + bgutil PO token provider
RUN apt-get update && apt-get install -y python3 python3-pip git && \
    pip3 install --break-system-packages yt-dlp --upgrade && \
    pip3 install --break-system-packages bgutil-ytdlp-pot-provider && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Symlink node so yt-dlp / bgutil can find it
RUN ln -sf /usr/local/bin/node /usr/bin/node && \
    ln -sf /usr/local/bin/node /usr/local/sbin/node

# Build bgutil PO-token server (best effort — API fallbacks handle failures)
RUN git clone https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /root/bgutil-ytdlp-pot-provider && \
    cd /root/bgutil-ytdlp-pot-provider/server && \
    npm install && npm install -g typescript && \
    npx tsc 2>&1 || true && \
    ls build/generate_once.js 2>/dev/null && echo "bgutil ✓ built" || echo "bgutil ✗ build skipped"

ENV PATH="/usr/local/bin:/usr/bin:${PATH}"

WORKDIR /app
COPY package.json .
RUN npm install --production
COPY server.js .

EXPOSE 3001
ENV PORT=3001
CMD ["node", "server.js"]
