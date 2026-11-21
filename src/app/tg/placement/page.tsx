import type { Metadata, Viewport } from "next";
import { quizLabels } from "../quiz/labels";
import { QuizApp } from "../quiz/quiz-app";

export const metadata: Metadata = { title: "Kirish testi", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover" };

/** Mini App: a center's placement test (/tg/placement?c=<slug>, opened from the bot's start link). */
export default function PlacementPage() {
  return <QuizApp mode="placement" labels={quizLabels()} />;
}
