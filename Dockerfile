FROM node:20-slim

# Install Python and yt-dlp
RUN apt-get update && apt-get install -y python3 python3-pip && \
    pip3 install --break-system-packages yt-dlp && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json .
RUN npm install --production
COPY server.js .

# Fix NUL redirect for Linux
RUN sed -i 's/2>NUL/2>\/dev\/null/g' server.js

EXPOSE 3001
CMD ["node", "server.js"]
