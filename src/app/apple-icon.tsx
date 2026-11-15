import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 40,
          background: "#2aa979",
          color: "#fff",
          fontFamily: "Arial",
          fontSize: 136,
          fontWeight: 700,
          letterSpacing: -12,
          paddingRight: 9,
        }}
      >
        A
      </div>
    ),
    size,
  );
}
