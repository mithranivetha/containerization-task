#Stage 1: Build
FROM node:20-alpine AS build

ARG VITE_API_URL=""
ARG VITE_SUPABASE_URL="https://dummy-project.supabase.co"
ARG VITE_SUPABASE_ANON_KEY="dummy-anon-key"
ARG VITE_SUPABASE_SERVICE_ROLE_KEY="dummy-service-role-key"

ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_SERVICE_ROLE_KEY=$VITE_SUPABASE_SERVICE_ROLE_KEY

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

#Stage 2: Serve
FROM nginx:alpine
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]