import { styles } from "../mobileStyles";
import { usesCompactRequestTitle, usesDenseRequestTitle } from "./requestTitleDensity";

export function requestTitleStyles(title: string) {
  return [
    styles.detailTitle,
    usesCompactRequestTitle(title) ? styles.detailTitleCompact : null,
    usesDenseRequestTitle(title) ? styles.detailTitleDense : null,
  ];
}

export function formatRequestTime(value?: string) {
  if (!value) {
    return "";
  }
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
