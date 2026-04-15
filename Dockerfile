FROM node:20-slim

# Ensure node is in standard PATH for yt-dlp to find
ENV PATH="/usr/local/bin:${PATH}"

# Install Python, pip, yt-dlp + bgutil PO token provider
RUN apt-get update && apt-get install -y python3 python3-pip git && \
    pip3 install --break-system-packages yt-dlp --upgrade && \
    pip3 install --break-system-packages bgutil-ytdlp-pot-provider && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Symlink node to /usr/bin so yt-dlp's shutil.which() finds it
RUN ln -sf $(which node) /usr/bin/node

# Build bgutil server scripts for PO token generation
RUN git clone https://github.com/nicholasgasior/bgutil-ytdlp-pot-provider.git /opt/bgutil && \
    cd /opt/bgutil/server && \
    npm install && \
    npx tsc 2>/dev/null || true

ENV BGUTIL_SCRIPT_PATH=/opt/bgutil/server

WORKDIR /app
COPY package.json .
RUN npm install --production
COPY server.js .

EXPOSE 3001
ENV PORT=3001
CMD ["node", "server.js"]
