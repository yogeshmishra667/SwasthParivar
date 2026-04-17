import React from "react";

declare global {
  namespace JSX {
    interface Element extends React.JSX.Element {}
    interface IntrinsicElements extends React.JSX.IntrinsicElements {}
  }
}
