FROM node:22-alpine

WORKDIR /app

# Install dependencies first to leverage Docker layer caching
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the app
COPY . .

# The server reads PORT from the environment (defaults to 3000)
EXPOSE 3000

CMD ["node", "server.js"]
