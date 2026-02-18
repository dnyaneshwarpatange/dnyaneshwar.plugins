# Use Node.js 18 (Slim version to save space)
FROM node:18-slim

# 1. Install dependencies required for Puppeteer/Chromium
# We install generic libraries that Chrome needs to run on Linux
RUN apt-get update \
    && apt-get install -y wget gnupg \
    && apt-get install -y fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
      --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 2. Set working directory
WORKDIR /app

# 3. Copy package files and install dependencies
COPY package*.json ./
# Install dependencies (including Puppeteer which downloads Chromium)
RUN npm ci

# 4. Copy the rest of the application code
COPY . .

# 5. Expose the port (matches PORT in .env)
EXPOSE 3000

# 6. Start the app
CMD ["npm", "start"]