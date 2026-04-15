FROM node:20-slim

# Install Python, pip, git, yt-dlp + bgutil PO token provider
RUN apt-get update && apt-get install -y python3 python3-pip git && \
    pip3 install --break-system-packages yt-dlp --upgrade && \
    pip3 install --break-system-packages bgutil-ytdlp-pot-provider && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Symlink node to multiple locations so yt-dlp can find it
RUN ln -sf /usr/local/bin/node /usr/bin/node && \
    ln -sf /usr/local/bin/node /usr/local/sbin/node

# Clone bgutil to the DEFAULT path the plugin expects (correct repo)
RUN git clone https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /root/bgutil-ytdlp-pot-provider && \
    cd /root/bgutil-ytdlp-pot-provider/server && \
    npm install && \
    npx tsc || true && \
    ls -la build/ 2>/dev/null || echo "No build dir"

# Ensure PATH includes node location
ENV PATH="/usr/local/bin:/usr/bin:${PATH}"

WORKDIR /app
COPY package.json .
RUN npm install --production
COPY server.js .

EXPOSE 3001
ENV PORT=3001
CMD ["node", "server.js"]
