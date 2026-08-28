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
  | 'coding_outline'
  | 'coding_git'
  | 'coding_typecheck'
  | 'coding_shell'
  | 'coding_explore'
  | 'settings'
  | 'reminder'
  | 'skill'
  | 'plan'
  | 'plan_progress'
  | 'mcp'
  | 'other'

/** One currently executing tool, used when a round contains parallel calls. */
export type AgentToolActivity = {
  id: string
  name: string
  phase: AgentToolUiPhase | null
}

export function toolPhaseForAgentTool(name: string): AgentToolUiPhase {
  if (
    name.startsWith('mcp__') ||
    name === 'mcp_list_tools' ||
    name === 'mcp_get_tool' ||
    name === 'mcp_read_result' ||
    name === 'mcp_call'
  ) {
    return 'mcp'
  }
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
    case 'find_symbols':
      return 'coding_outline'
    case 'git_status':
    case 'git_diff':
    case 'git_log':
    case 'git_show':
    case 'git_restore':
    case 'git_stash':
      return 'coding_git'
    case 'check_types':
      return 'coding_typecheck'
    case 'execute_command':
      return 'coding_shell'
    case 'list_processes':
    case 'stop_process':
    case 'read_process_output':
      return 'coding_shell'
    case 'coding_explore':
      return 'coding_explore'
    case 'run_coding_workers':
      return 'coding_explore'
    case 'update_settings':
      return 'settings'
    case 'add_reminder':
    case 'list_reminders':
    case 'delete_reminder':
    case 'update_reminder':
      return 'reminder'
    case 'read_skill':
      return 'skill'
    case 'enter_plan_mode':
      return 'plan'
    case 'update_plan_progress':
      return 'plan_progress'
    default:
      return 'other'
  }
}
