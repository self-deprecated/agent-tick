FROM golang:1.25-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/agent-tick ./cmd/agent-tick

FROM alpine:3.22

RUN addgroup -S agenttick && adduser -S agenttick -G agenttick
WORKDIR /data
COPY --from=build /out/agent-tick /usr/local/bin/agent-tick
USER agenttick
EXPOSE 8787

ENTRYPOINT ["agent-tick"]
CMD ["server", "--addr", ":8787", "--data", "/data/agent-tick.db"]
