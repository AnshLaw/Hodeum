import type { Bus } from "../../lib/bus";
import type { ChatStore, LearningStore } from "../../data/types";

/**
 * Tells sync (in the notch) about deletions made in the app window, so the cloud copy is deleted
 * too rather than pulled back. Wraps the stores in place; the stores stay the source of truth.
 */
export function trackDeletions(learning: LearningStore, chats: ChatStore, bus: Bus): void {
  const resetSkill = learning.resetSkill.bind(learning);
  learning.resetSkill = async (skillId) => {
    await resetSkill(skillId);
    bus.emit("sync:deleted", { table: "skills", id: skillId });
  };
  const deleteChat = chats.deleteChat.bind(chats);
  chats.deleteChat = async (chatId) => {
    await deleteChat(chatId);
    bus.emit("sync:deleted", { table: "chats", id: chatId });
  };
}
