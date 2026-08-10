import * as React from "react";

type Props = {
  /** The size of the icon, 24px is default to match standard icons */
  size?: number;
  /** The color of the icon, defaults to the current text color */
  fill?: string;
};

export default function Icon({ size = 24, fill = "currentColor" }: Props) {
  return (
    <svg
      fill={fill}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      version="1.1"
    >
      <path d="M10.2 5.5 9.6 9H13l.6-3.5a.75.75 0 1 1 1.48.25L14.52 9H17a.75.75 0 0 1 0 1.5h-2.73l-.5 3H16a.75.75 0 0 1 0 1.5h-2.48l-.6 3.5a.75.75 0 1 1-1.48-.25l.56-3.25H8.6l-.6 3.5a.75.75 0 1 1-1.48-.25L7.08 15.5H5a.75.75 0 0 1 0-1.5h2.33l.5-3H6a.75.75 0 0 1 0-1.5h2.08l.6-3.5a.75.75 0 1 1 1.48.25Zm-.86 5-.5 3h3.4l.5-3Z" />
    </svg>
  );
}
