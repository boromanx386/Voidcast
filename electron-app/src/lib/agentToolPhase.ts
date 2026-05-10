/**
 * UI phase for the chat “tool activity” strip (see App `ToolIndicator`).
 * Maps 1:1 from `executeToolCall` / OpenRouter tool `name` via `toolPhaseForAgentTool`.
 */
export type AgentToolUiPhase =
  | 'search'
  | 'youtube'
  | 'reddit'
  | 'weather'
  | 'scrape'
  | 'pdf'
  | 'image'
  /** Chat image recall for multimodal / vision (not Runware generation). */
  | 'vision'
  | 'music'
  | 'coding_list'
  | 'coding_read'
  | 'coding_write'
  | 'coding_edit'
  | 'coding_search'
  | 'coding_glob'
  | 'coding_git'
  | 'coding_shell'
  | 'settings'
  | 'reminder'
  | 'other'

export function toolPhaseForAgentTool(name: string): AgentToolUiPhase {
  switch (name) {
    case 'web_search':
      return 'search'
    case 'search_youtube':
      return 'youtube'
    case 'reddit_feed':
      return 'reddit'
    case 'get_weather':
      return 'weather'
    case 'scrape_url':
      return 'scrape'
    case 'save_pdf':
      return 'pdf'
    case 'generate_image':
    case 'edit_image_runware':
      return 'image'
    case 'image_recall':
      return 'vision'
    case 'generate_music_runware':
      return 'music'
    case 'list_directory':
      return 'coding_list'
    case 'read_file':
      return 'coding_read'
    case 'write_file':
      return 'coding_write'
    case 'edit_code':
      return 'coding_edit'
    case 'search_files':
      return 'coding_search'
    case 'glob_files':
      return 'coding_glob'
    case 'git_status':
    case 'git_diff':
    case 'git_log':
    case 'git_show':
      return 'coding_git'
    case 'execute_command':
      return 'coding_shell'
    case 'update_settings':
      return 'settings'
    case 'add_reminder':
    case 'list_reminders':
    case 'delete_reminder':
    case 'update_reminder':
      return 'reminder'
    default:
      return 'other'
  }
}
