import { useState, useEffect } from 'react';
import { CheckCircle2, Circle, Loader2, ListTodo, ChevronDown, ChevronRight, Bot } from 'lucide-react';
import './TodoList.css';

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface AgentTodos {
  agentId: string;
  agentName: string;
  /** For subagents: the Task description (what this agent was asked to do). */
  task?: string;
  todos: TodoItem[];
}

interface TodoListProps {
  agentTodos: Record<string, AgentTodos>;
}

function AgentTodoSection({ agentTodos, isMain }: { agentTodos: AgentTodos; isMain: boolean }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const { agentName, task, todos } = agentTodos;

  const completedCount = todos.filter(t => t.status === 'completed').length;
  const totalCount = todos.length;
  const hasInProgress = todos.some(t => t.status === 'in_progress');
  const allDone = totalCount > 0 && completedCount === totalCount;

  // Auto-collapse when the last todo completes. User can still click to review.
  useEffect(() => {
    if (allDone) setIsExpanded(false);
  }, [allDone]);

  const getStatusIcon = (status: TodoItem['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="todo-icon completed" size={14} />;
      case 'in_progress':
        return <Loader2 className="todo-icon in-progress spinning" size={14} />;
      default:
        return <Circle className="todo-icon pending" size={14} />;
    }
  };

  return (
    <div className={`agent-todo-section ${isMain ? 'main-agent' : 'sub-agent'}`}>
      <button
        className="agent-section-header"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className="expand-icon">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <Bot size={14} className="agent-icon" />
        <span className="agent-name-group">
          <span className="agent-name">{agentName}</span>
          {task && <span className="agent-task">{task}</span>}
        </span>
        <span className="agent-todo-count">{completedCount}/{totalCount}</span>
        {hasInProgress && <span className="agent-active-indicator" />}
      </button>

      {isExpanded && (
        <div className="agent-todo-items">
          {todos.map((todo, index) => (
            <div key={index} className={`todo-item ${todo.status}`}>
              <div className="todo-status">{getStatusIcon(todo.status)}</div>
              <div className="todo-content"><span className="todo-text">{todo.content}</span></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TodoList({ agentTodos }: TodoListProps) {
  const agentIds = Object.keys(agentTodos);
  const hasAnyTodos = agentIds.length > 0;

  // Calculate overall stats
  const allTodos = agentIds.flatMap(id => agentTodos[id].todos);
  const totalCompleted = allTodos.filter(t => t.status === 'completed').length;
  const totalCount = allTodos.length;
  const hasAnyInProgress = allTodos.some(t => t.status === 'in_progress');

  // Sort: main agent first, then subagents
  const sortedAgentIds = [...agentIds].sort((a, b) => {
    if (a === 'main') return -1;
    if (b === 'main') return 1;
    return 0;
  });

  return (
    <div className="todo-list-container">
      <div className="todo-list-header">
        <ListTodo className="header-icon" size={18} />
        <h2 className="header-title">Task Queue</h2>
        {totalCount > 0 && (
          <span className="todo-count">{totalCompleted}/{totalCount}</span>
        )}
      </div>

      {totalCount > 0 && (
        <div className="todo-progress-bar">
          <div
            className="todo-progress-fill"
            style={{ width: `${(totalCompleted / totalCount) * 100}%` }}
          />
        </div>
      )}

      <div className="todo-list">
        {!hasAnyTodos ? (
          <div className="todo-empty">
            <div className="empty-icon">
              <ListTodo size={24} />
            </div>
            <p>No active tasks</p>
            <span className="empty-hint">Tasks will appear here as the agent works</span>
          </div>
        ) : (
          sortedAgentIds.map(agentId => (
            <AgentTodoSection
              key={agentId}
              agentTodos={agentTodos[agentId]}
              isMain={agentId === 'main'}
            />
          ))
        )}
      </div>

      {hasAnyInProgress && (
        <div className="todo-activity-indicator">
          <div className="activity-pulse"></div>
          <span>Agent working...</span>
        </div>
      )}
    </div>
  );
}

export default TodoList;
