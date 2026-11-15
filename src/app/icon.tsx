import { ImageResponse } from "next/og";

export const size = {
  width: 32,
  height: 32,
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 8,
          background: "#2aa979",
          color: "#fff",
          fontFamily: "Arial",
          fontSize: 25,
          fontWeight: 700,
          letterSpacing: -2,
          paddingRight: 2,
        }}
      >
        A
      </div>
    ),
    size,
  );
}
