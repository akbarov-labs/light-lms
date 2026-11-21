import type { Metadata, Viewport } from "next";
import { quizLabels } from "./labels";
import { QuizApp } from "./quiz-app";

export const metadata: Metadata = { title: "Test", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover" };

/** Mini App: a student's (or a parent's) topic tests. Everything personal is loaded with Telegram's signed init data. */
export default function QuizPage() {
  return <QuizApp mode="topic" labels={quizLabels()} />;
}
