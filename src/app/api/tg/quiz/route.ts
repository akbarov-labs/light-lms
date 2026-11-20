// Mini App tests: topic tests of the chat's students and the center's placement test. Every call carries
// Telegram.WebApp.initData (verified with the bot token, ?b=<bot id> for a center's own bot): the chat it signs
// is who is asking, and the service checks that chat may see each student and attempt. Keys never leave here.
import { z } from "zod";
import { webAppCaller } from "@/lib/telegram-webapp-auth";
import { withBotScope } from "@/lib/managed-bots/scope";
import { validLinks } from "@/lib/telegram-links";
import { chatLocale } from "@/worker/bot/data";
import { makeT } from "@/lib/i18n";
import { UserError } from "@/lib/user-error";
import { attemptViewFor, chatQuizzes, placementCenter, placementInfo, saveQuizAnswer, startPlacement, startQuizAttempt, submitQuizAttempt } from "@/lib/services/quizzes";

export const dynamic = "force-dynamic";

const id = z.string().min(1).max(40);
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), initData: z.string() }),
  z.object({ action: z.literal("start"), initData: z.string(), quizId: id, studentId: id }),
  z.object({ action: z.literal("view"), initData: z.string(), attemptId: id }),
  z.object({ action: z.literal("answer"), initData: z.string(), attemptId: id, q: z.number().int().min(0).max(200), value: z.string().max(40) }),
  z.object({ action: z.literal("submit"), initData: z.string(), attemptId: id }),
  z.object({ action: z.literal("placementInfo"), initData: z.string(), c: z.string().max(40).nullish() }),
  z.object({
    action: z.literal("placementStart"),
    initData: z.string(),
    c: z.string().max(40).nullish(),
    topicId: id,
    firstName: z.string().max(60).nullish(),
    lastName: z.string().max(60).nullish(),
    phone: z.string().max(30).nullish(),
  }),
]);

const noStore = { headers: { "cache-control": "no-store" } };

export async function POST(req: Request) {
  let input: z.infer<typeof body>;
  try {
    input = body.parse(JSON.parse((await req.text()).slice(0, 16_384)));
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const caller = await webAppCaller(req, input.initData);
  if (!caller.ok) return caller.response;
  const { chatId, user, scope } = caller;
  const locale = (await chatLocale(chatId)) ?? (user.language_code === "ru" ? "ru" : "uz");
  try {
    const data = await withBotScope(scope, async () => {
      switch (input.action) {
        case "list": {
          const links = await validLinks(chatId);
          return { linked: links.guardianIds.length + links.studentIds.length > 0, quizzes: await chatQuizzes(chatId) };
        }
        case "start":
          return { attempt: await startQuizAttempt(chatId, input.quizId, input.studentId) };
        case "view":
          return { attempt: await attemptViewFor(input.attemptId, chatId) };
        case "answer":
          return await saveQuizAnswer(input.attemptId, chatId, input.q, input.value);
        case "submit":
          return { attempt: await submitQuizAttempt(input.attemptId, chatId) };
        case "placementInfo": {
          const center = await placementCenter(input.c ?? null, scope?.centerId ?? null);
          const info = center ? await placementInfo(center.id, chatId) : null;
          return center && info ? { center: { name: center.name }, info } : { closed: true };
        }
        case "placementStart": {
          const center = await placementCenter(input.c ?? null, scope?.centerId ?? null);
          if (!center) throw new UserError("quizzes.closed");
          return { attempt: await startPlacement(center.id, chatId, input) };
        }
      }
    });
    return Response.json({ locale, ...data }, noStore);
  } catch (e) {
    if (e instanceof UserError) return Response.json({ locale, error: e.key, message: makeT(locale)(e.key, e.vars) }, { status: 400, ...noStore });
    console.error("[tg/quiz]", e);
    return Response.json({ locale, error: "server" }, { status: 500, ...noStore });
  }
}
