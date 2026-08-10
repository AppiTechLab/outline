import * as React from "react";

type Props = {
  /** The size of the icon, 24px is default to match standard icons */
  size?: number;
  /** The color of the icon, defaults to the current text color */
  fill?: string;
};

/** The GitLab tanuki, simplified to a single path. */
export default function Icon({ size = 24, fill = "currentColor" }: Props) {
  return (
    <svg
      fill={fill}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      version="1.1"
    >
      <path d="M12 20.6 8.8 12.9h6.4L12 20.6ZM4.6 12.9l-1 3a.66.66 0 0 0 .24.74L12 20.6l-7.4-7.7ZM4.6 12.9h4.2L7 5.1a.34.34 0 0 0-.65 0L4.6 12.9ZM19.4 12.9l1 3a.66.66 0 0 1-.24.74L12 20.6l7.4-7.7ZM19.4 12.9h-4.2L17 5.1a.34.34 0 0 1 .65 0l1.75 7.8Z" />
    </svg>
  );
}
