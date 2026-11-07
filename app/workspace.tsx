"use client";
// Copyright © 2026 Alen Pepa

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { ArrowDown, ArrowDownToLine, ArrowRight, ArrowUp, AudioLines, BookOpen, Box, BrainCircuit, Check, ChevronDown, ChevronRight, Code2, Copy, Cpu, Download, FileText, Fingerprint, FlaskConical, FolderCode, GitBranch, Globe2, Headphones, Layers3, Loader2, Menu, MessageSquare, Mic, Moon, PanelLeftClose, PanelLeftOpen, Pencil, Pin, Plus, RotateCcw, ScanLine, Search, Settings2, ShieldCheck, Sparkles, Square, Star, Sun, Terminal, Trash2, Volume2, VolumeX, X, Zap, SlidersHorizontal } from "lucide-react";
import { templates, playbookRequest, type AgentMode, type Locale } from "../lib/templates";
import { runLocalAgent } from "../lib/local-agent";
import { createStarterBundle, isLegacyStarter, restoreBundle, starterExamples, type ModelBundle } from "../lib/local-model";
import { trainInWorker } from "../lib/model-training";
import Markdown, { downloadText } from "./markdown";
import Studio, { type StudioTab } from "./studio";
import BrandMark from "./brand-mark";
import AppFooter from "./app-footer";
import { StartHero, PromptLibrary } from "./start-screen";
import { extractArtifacts, codeExtension, type Artifact } from "../lib/local-tools";
import ConversationSetup, { conversationError, type ConversationSetupProps } from "./conversation-setup";
import { defaultConversationModel, prepareConversation, type ConversationModelId } from "../lib/conversation";
import { useConversationSession } from "./use-conversation-session";
import { type Attachment, type Chat, type Message } from "../lib/workspace-state";
import { WorkspaceStorage, type WorkspaceStorageIssue } from "../lib/workspace-storage";
import WorkspaceRecovery, { SavingWarning } from "./workspace-recovery";
import { readAttachments } from "../lib/attachments";
import { connectSpeechOutput, recognitionFactory, RecognitionSession, speechChunks, type SpeechOutput } from "../lib/voice";
import { COPYRIGHT_NOTICE } from "../lib/brand";
import { attributeMarkdown } from "../lib/copyright";
import { errorMessage } from "../lib/errors";
import { getChatModel } from "../lib/chat-models";
import { getCpuModel } from "../lib/cpu-models";
import type { DeviceBudget } from "../lib/device-capabilities";
import { branchContinuation, branchRefinement, branchQuestion, highlightedText, mergeConversationBackup, questionForResponse, searchConversations, sortedConversations, type ConversationBackup, type SearchFilter } from "../lib/conversation-workspace";
import ConversationBackupPanel from "./conversation-backup";
import UsernameOnboarding from "./username-onboarding";
import UsernameForm from "./username-form";
import { readUserProfile, saveUserProfile, usernameInitials } from "../lib/user-profile";
import { readAssistantPreferences, writeAssistantPreferences, normalizeAssistantPreferences, defaultAssistantPreferences, assistantPreferencePrompt, type AssistantPreferences } from "../lib/assistant-preferences";
import { DraftAutosave, DraftStorage, updateDraft, removeDraft, type Draft, type DraftStorageIssue } from "../lib/drafts";
import { saveProject, removeProject, type Project } from "../lib/projects";
import ProjectNavigation from "./project-navigation";
import AssistantSettings from "./assistant-settings";
import KnowledgeLibrary from "./knowledge-library";
import KnowledgeSources from "./knowledge-sources";
import ConversationContext from "./conversation-context";
import WindowsTerminal from "./windows-terminal";
import { terminalAiContext, type WindowsResult } from "../lib/windows-terminal";
import ResponseRefine from "./response-refine";
import AnswerQuality from "./answer-quality";
import { readKnowledgeLibrary, validateKnowledgeDocuments, writeKnowledgeLibrary, type KnowledgeDocument, type KnowledgeExcerpt } from "../lib/knowledge-library";
import { mobileProfile } from "../lib/mobile-device";
import { connectMobileLifecycle, connectMobileViewport } from "../lib/mobile-lifecycle";
import { restoreRuntimePreference, selectedRuntimePreference, runtimeLabel } from "../lib/runtime-preference";
import { normalizeGpuPreference, type GpuPreference } from "../lib/gpu-selection";
import AiOnboarding from "./ai-onboarding";
import { readConversationSettings, writeConversationSettings, normalizeConversationSettings, type ChatEngine } from "../lib/conversation-settings";
import { finishFirstRun, selectFirstRunEngine, type FirstRunChoice } from "../lib/first-run";

import CodeProjects, { projectErrorText } from "./code-projects";
import { useProjectVersions } from "./use-project-versions";
import { appendCodeProjectRequest, codeProjectFromArtifacts, readCodeProjects, validateCodeProjects, writeCodeProjects, type CodeProject } from "../lib/code-projects";

type Modal = "ai" | "settings" | "search" | "playbooks" | "saved" | "voice" | "delete" | "rename" | "edit" | "project" | "knowledge" | "code-projects" | "terminal" | null;
type BranchSource = { chatId: string; questionId: string } | { chatId: string; responseId: string; intent?: "refine" };

const uid = () => typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
const modelStorageKey = "aegis-local-model-v2";
const iconMap = { code: Code2, scan: ScanLine, terminal: Terminal, fingerprint: Fingerprint };

function dialogControls(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), a[href]"))
    .filter(item => item.getClientRects().length > 0 && !item.closest("[hidden], [inert]"));
}

export default function Workspace() {
  const [locale, setLocale] = useState<Locale>("en");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const t = (en: string, de: string) => locale === "de" ? de : en;
  const [chats, setChats] = useState<Chat[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectEditingId, setProjectEditingId] = useState<string | null>(null);
  const [projectTitle, setProjectTitle] = useState("");
  const [projectError, setProjectError] = useState("");
  const [assistantPreferences, setAssistantPreferences] = useState<AssistantPreferences>({ ...defaultAssistantPreferences });
  const [assistantPreferencesPersisted, setAssistantPreferencesPersisted] = useState(true);
  const [showContext, setShowContext] = useState(false);
  const [generationPhase, setGenerationPhase] = useState<{ id: string; phase: "draft" | "review" } | null>(null);
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocument[]>([]);
  const [knowledgePersisted, setKnowledgePersisted] = useState(true);
  const [knowledgeLoadError, setKnowledgeLoadError] = useState(false);
  const [codeProjects, setCodeProjects] = useState<CodeProject[]>([]);
  const [selectedCodeProjectId, setSelectedCodeProjectId] = useState<string | null>(null);
  const [codeProjectsStatus, setCodeProjectsStatus] = useState<"saved" | "pending" | "failed">("saved");
  const [codeProjectsLoadError, setCodeProjectsLoadError] = useState(false);
  const [pendingCodeImport, setPendingCodeImport] = useState<CodeProject | null>(null);
  const codeProjectsRef = useRef<CodeProject[]>([]);
  const codeProjectsDirty = useRef(false);
  const projectVersions = useProjectVersions();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [workspaceStorageIssue, setWorkspaceStorageIssue] = useState<WorkspaceStorageIssue | null>(null);
  const [draftStorageIssue, setDraftStorageIssue] = useState<DraftStorageIssue | null>(null);
  const [workspaceSaveFailed, setWorkspaceSaveFailed] = useState(false);
  const [draftSaveFailed, setDraftSaveFailed] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [usernamePersisted, setUsernamePersisted] = useState(true);
  const [needsModelSetup, setNeedsModelSetup] = useState(false);
  const [startupChoicePersisted, setStartupChoicePersisted] = useState(true);
  const [editingStartupUsername, setEditingStartupUsername] = useState(false);
  const [modelBundle, setModelBundle] = useState<ModelBundle | null>(null);
  const [chatEngine, setChatEngine] = useState<"chat" | "tools">("chat");
  const [selectedChatModel, setSelectedChatModel] = useState<ConversationModelId>(defaultConversationModel);
  const [cpuExplicitChoice, setCpuExplicitChoice] = useState(false);
  const [deviceBudget, setDeviceBudget] = useState<DeviceBudget>({});
  const [gpuPreference, setGpuPreference] = useState<GpuPreference>("auto");
  const [isMobileDevice, setIsMobileDevice] = useState(false);
  const [pausePhoneInBackground, setPausePhoneInBackground] = useState(true);
  const { session: conversation, state: conversationState, ready: conversationReady } = useConversationSession(deviceBudget, gpuPreference);
  const [clearingModelCache, setClearingModelCache] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<AgentMode>("auto");
  const [modeOpen, setModeOpen] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [readingFiles, setReadingFiles] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [studioTab, setStudioTab] = useState<StudioTab>("tools");
  const [selectedArtifact, setSelectedArtifact] = useState<string | null>(null);
  const [artifactIntent, setArtifactIntent] = useState<"code" | "preview">("code");
  const [artifactRequest, setArtifactRequest] = useState(0);
  const [extraArtifact, setExtraArtifact] = useState<Artifact | null>(null);
  const [modal, setModalState] = useState<Modal>(null);
  const [query, setQuery] = useState("");
  const [searchFilter, setSearchFilter] = useState<SearchFilter>("all");
  const [focusedMessage, setFocusedMessage] = useState<{ id: string } | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [editSource, setEditSource] = useState<BranchSource | null>(null);
  const [editText, setEditText] = useState("");
  const [notice, setNotice] = useState("");
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [voiceId, setVoiceId] = useState("");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [micAvailable, setMicAvailable] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [justCopied, setJustCopied] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef(new RecognitionSession());
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speechOutputRef = useRef<SpeechOutput | null>(null);
  const attachmentLoading = useRef<AbortController | null>(null);
  const speakingToken = useRef(0);
  const busyRef = useRef(false);
  const storageWarning = useRef(false);
  const workspaceStorage = useRef(new WorkspaceStorage());
  const draftStorage = useRef(new DraftStorage());
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const draftsRef = useRef<Draft[]>([]);
  const draftAutosave = useRef(new DraftAutosave());
  const current = chats.find(chat => chat.id === activeId);
  const messages = current?.messages || [];
  const isChat = messages.length > 0;
  const artifacts = useMemo(() => extractArtifacts(current?.messages || []), [current?.messages]);
  const studioArtifacts = extraArtifact && !artifacts.some(item => item.id === extraArtifact.id) ? [...artifacts, extraArtifact] : artifacts;
  const saved = chats.flatMap(chat => chat.messages.filter(message => message.saved).map(message => ({ chat, message })));
  const orderedChats = useMemo(() => sortedConversations(activeProjectId ? chats.filter(chat => chat.projectId === activeProjectId) : chats), [chats, activeProjectId]);
  const searchResults = useMemo(() => modal === "search" ? searchConversations(chats, query, searchFilter, 50, projects) : [], [chats, query, searchFilter, projects, modal]);
  const activeProject = projects.find(project => project.id === (current?.projectId || activeProjectId));
  const modeLabels: Record<AgentMode, string> = { auto: t("Auto", "Auto"), investigate: t("Investigate", "Analysieren"), build: t("Build", "Erstellen"), learn: t("Learn", "Lernen") };
  const selectedChatModelInfo = getChatModel(selectedChatModel)!;
  const activeChatModelName = getChatModel(conversationState.modelId)?.name;
  const activeProcessor = [runtimeLabel(conversationState.modelId), conversationState.gpu?.name].filter(Boolean).join(" · ");
  const storageLabel = workspaceStorageIssue || workspaceSaveFailed
    ? t("Changes not saved · Export this session", "Änderungen nicht gespeichert · Sitzung exportieren")
    : draftStorageIssue || draftSaveFailed
      ? t("Draft saving paused · Copy unsent text", "Entwürfe nicht gespeichert · Ungesendeten Text kopieren")
      : t("Conversations stay on this device", "Gespräche bleiben auf diesem Gerät");

  useEffect(() => {
    const profile = readUserProfile();
    setUsername(profile?.username || null); setNeedsModelSetup(profile?.setupPending === true); setStartupChoicePersisted(Boolean(profile) && !profile?.setupPending);
    const phone = mobileProfile(navigator); setIsMobileDevice(phone.mobile);
    setSelectedChatModel(restoreRuntimePreference(null, phone.mobile).modelId);
    let restoredActiveId: string | null = null;
    const savedWorkspace = workspaceStorage.current.read();
    setWorkspaceStorageIssue(savedWorkspace.issue);
    if (savedWorkspace.data) {
      const data = savedWorkspace.data;
      setChats(data.chats); setActiveId(data.activeId); setLocale(data.locale); setTheme(data.theme);
      setAutoSpeak(data.autoSpeak); setCollapsed(data.collapsed); setVoiceId(data.voiceId);
      setProjects(data.projects); setActiveProjectId(data.activeProjectId); restoredActiveId = data.activeId;
      const restoredDrafts = draftStorage.current.read(new Set(data.chats.map(chat => chat.id)));
      draftsRef.current = restoredDrafts.drafts; setDraftStorageIssue(restoredDrafts.issue);
      if (data.repaired) setNotice("Recovered interrupted replies and repaired invalid saved entries. / Unterbrochene Antworten wiederhergestellt und ungültige Einträge repariert.");
    }
    try {
      const preferences = readConversationSettings(undefined, phone.mobile);
      setSelectedChatModel(preferences.modelId); setCpuExplicitChoice(preferences.cpuExplicitChoice);
      setDeviceBudget(preferences.hardwareBudget); setGpuPreference(preferences.gpuPreference);
      setPausePhoneInBackground(preferences.pausePhoneInBackground); setChatEngine(preferences.engine);
    } catch { /* Invalid preferences do not prevent opening the workspace. */ }
    setAssistantPreferences(readAssistantPreferences());
    const knowledge = readKnowledgeLibrary();
    setKnowledgeDocuments(knowledge.documents); setKnowledgePersisted(knowledge.persisted); setKnowledgeLoadError(Boolean(knowledge.error));
    const restoredCode = readCodeProjects();
    codeProjectsRef.current = restoredCode.projects; setCodeProjects(restoredCode.projects);
    setCodeProjectsLoadError(restoredCode.error); setCodeProjectsStatus(restoredCode.error ? "failed" : "saved");
    const restoredDraft = draftsRef.current.find(item => item.chatId === restoredActiveId);
    if (restoredDraft) { setPrompt(restoredDraft.text); setAttachments(restoredDraft.attachments); setMode(restoredDraft.mode); setChatEngine(restoredDraft.engine); }
    const preparation = new AbortController();
    let restoredModel: ModelBundle | null = null;
    try {
      const savedModel = JSON.parse(localStorage.getItem(modelStorageKey) || localStorage.getItem("aegis-local-model-v1") || "null");
      if (savedModel) { restoredModel = restoreBundle(savedModel); if (restoredModel.model.version === 2 && ["AEGIS Hybrid v2", "NYQAL Hybrid v2"].includes(restoredModel.model.name)) restoredModel = { ...restoredModel, model: { ...restoredModel.model, name: "AELVOR Hybrid v2" } }; setModelBundle(restoredModel); }
    } catch { setNotice("Saved model could not be loaded; preparing a starter. / Gespeichertes Modell konnte nicht geladen werden; Startmodell wird vorbereitet."); }
    if (!restoredModel || isLegacyStarter(restoredModel)) {
      const original = restoredModel;
      void trainInWorker(starterExamples, "AELVOR Hybrid v2", { signal: preparation.signal }).then(next => {
        setModelBundle(current => current === original ? next : current);
      }).catch(() => {
        if (!preparation.signal.aborted && !original) setModelBundle(current => current || createStarterBundle());
      });
    }
    setLoaded(true);

    setMicAvailable(Boolean(recognitionFactory(() => window)));
    const output = connectSpeechOutput(() => typeof SpeechSynthesisUtterance === "function" ? window.speechSynthesis : null, setVoices);
    speechOutputRef.current = output; setVoiceAvailable(Boolean(output));
    return () => { preparation.abort(); speakingToken.current++; utteranceRef.current = null; output?.dispose(); if (speechOutputRef.current === output) speechOutputRef.current = null; recognitionRef.current.cancel(); attachmentLoading.current?.abort(); abortRef.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!loaded || workspaceStorageIssue) return;
    const save = () => {
      const saved = workspaceStorage.current.save({ chats, projects, activeProjectId, activeId, locale, autoSpeak, voiceId, collapsed, theme });
      setWorkspaceSaveFailed(!saved);
      if (!saved && !storageWarning.current) {
        storageWarning.current = true; setNotice(t("Device storage is full or unavailable. Export important conversations.", "Der Gerätespeicher ist voll oder nicht verfügbar. Exportiere wichtige Gespräche."));
      }
    };
    const onHidden = () => { if (document.visibilityState === "hidden") save(); };
    const timer = setTimeout(save, 250);
    window.addEventListener("pagehide", save); document.addEventListener("visibilitychange", onHidden);
    return () => { clearTimeout(timer); window.removeEventListener("pagehide", save); document.removeEventListener("visibilitychange", onHidden); };
  }, [chats, projects, activeProjectId, activeId, locale, autoSpeak, voiceId, collapsed, theme, loaded, workspaceStorageIssue]);

  useEffect(() => {
    if (!loaded || workspaceStorageIssue || draftStorageIssue) return;
    const save = draftAutosave.current.createSave(() => stashDraft());
    const hidden = () => { if (document.visibilityState === "hidden") save(); };
    const timer = setTimeout(save, 250);
    window.addEventListener("pagehide", save); document.addEventListener("visibilitychange", hidden);
    return () => { clearTimeout(timer); window.removeEventListener("pagehide", save); document.removeEventListener("visibilitychange", hidden); };
  }, [prompt, attachments, mode, chatEngine, activeId, loaded, workspaceStorageIssue, draftStorageIssue]);

  useEffect(() => {
    if (!loaded) return;
    const save = () => {
      if (!codeProjectsDirty.current) return;
      const saved = writeCodeProjects(codeProjectsRef.current);
      if (saved) codeProjectsDirty.current = false;
      setCodeProjectsStatus(saved ? "saved" : "failed");
    };
    const hidden = () => { if (document.visibilityState === "hidden") save(); };
    const timer = setTimeout(save, 400);
    window.addEventListener("pagehide", save); document.addEventListener("visibilitychange", hidden);
    return () => { clearTimeout(timer); window.removeEventListener("pagehide", save); document.removeEventListener("visibilitychange", hidden); };
  }, [codeProjects, loaded]);

  useEffect(() => {
    if (!loaded || !modelBundle) return;
    try { localStorage.setItem(modelStorageKey, JSON.stringify(modelBundle)); }
    catch { if (!storageWarning.current) { storageWarning.current = true; setNotice(t("The model could not be saved on this device. Export a copy from Model lab.", "Das Modell konnte auf diesem Gerät nicht gespeichert werden. Exportiere eine Kopie im Model-Lab.")); } }
  }, [modelBundle, loaded]);

  useEffect(() => {
    if (!loaded) return;
    writeConversationSettings({ engine: chatEngine, modelId: selectedChatModel, cpuExplicitChoice, hardwareBudget: deviceBudget, pausePhoneInBackground, gpuPreference });
  }, [chatEngine, selectedChatModel, cpuExplicitChoice, deviceBudget, pausePhoneInBackground, gpuPreference, loaded]);

  useEffect(() => {
    if (!loaded || !isMobileDevice) return;
    return connectMobileViewport(window.visualViewport, height => {
      if (height === null) document.documentElement.style.removeProperty("--phone-viewport-height");
      else document.documentElement.style.setProperty("--phone-viewport-height", `${height}px`);
    });
  }, [loaded, isMobileDevice]);

  useEffect(() => {
    if (!loaded) return;
    return connectMobileLifecycle(document, isMobileDevice && pausePhoneInBackground, () => {
      const status = conversation.getSnapshot().status;
      stopListening(); stopSpeech();
      if (status === "loading" || status === "ready" || status === "generating") {
        if (status === "generating") abortRef.current?.abort();
        conversation.unload();
        setNotice(t("Phone AI released in the background. Load the cached model again to continue.", "Smartphone-AI im Hintergrund freigegeben. Lade das gespeicherte Modell erneut, um fortzufahren."));
      }
    });
  }, [loaded, isMobileDevice, pausePhoneInBackground, conversation, locale]);

  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { if (!notice || !loaded || !username) return; const timer = setTimeout(() => setNotice(""), 5000); return () => clearTimeout(timer); }, [notice, loaded, username]);
  useEffect(() => {
    const node = textarea.current;
    if (node) { node.style.height = "auto"; node.style.height = `${Math.min(node.scrollHeight, 180)}px`; }
  }, [prompt]);
  useEffect(() => {
    if (atBottom && scrollArea.current) scrollArea.current.scrollTop = scrollArea.current.scrollHeight;
  }, [messages.at(-1)?.content, activeId, atBottom]);
  useEffect(() => {
    if (!focusedMessage) return;
    const frame = requestAnimationFrame(() => document.getElementById(`message-${focusedMessage.id}`)?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" }));
    const timer = setTimeout(() => setFocusedMessage(null), 3000);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [focusedMessage, activeId]);
  useEffect(() => {
    if (modal) {
      const timer = setTimeout(() => {
        const dialog = dialogRef.current; if (!dialog) return;
        const controls = dialogControls(dialog);
        (controls.find(item => item.matches("input, textarea, select")) || controls[0] || dialog).focus();
      }, 10);
      return () => clearTimeout(timer);
    }
    if (previousFocus.current?.isConnected) previousFocus.current.focus();
    else textarea.current?.focus();
  }, [modal]);
  useEffect(() => {
    if (!loaded || !username || needsModelSetup || editingStartupUsername) return;
    const keyboard = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "k") { event.preventDefault(); setModal("search"); }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "o") { event.preventDefault(); newChat(); }
      if (event.key === "Escape") { closeModal(); setSidebar(false); setModeOpen(false); if (!modal) setStudioOpen(false); }
      if (event.key === "Tab" && modal && dialogRef.current) {
        const visible = dialogControls(dialogRef.current);
        const first = visible[0], last = visible.at(-1);
        if (!first) { event.preventDefault(); dialogRef.current.focus(); }
        else if (!dialogRef.current.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [modal, loaded, username, needsModelSetup, editingStartupUsername, prompt, attachments, mode, chatEngine, activeId, locale]);

  function setModal(next: Modal) {
    // Capture the trigger before autoFocus moves into the dialog, and retain it
    // when switching between dialogs such as Settings and the model library.
    if (next && !modal) previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (modal === "voice" && next !== "voice") { stopListening(); stopSpeech(); }
    setModalState(next);
  }
  function chooseUsername(value: string) {
    const firstRun = !username || needsModelSetup || editingStartupUsername;
    const result = saveUserProfile(value, undefined, { setupPending: firstRun || !startupChoicePersisted });
    setUsername(result.profile.username); setUsernamePersisted(result.persisted);
    if (firstRun) { setNeedsModelSetup(true); setEditingStartupUsername(false); }
    if (!result.persisted) setNotice(t("Your username is active for this visit, but browser storage is unavailable. You may be asked again next time.", "Dein Benutzername gilt für diesen Besuch, aber der Browserspeicher ist nicht verfügbar. Beim nächsten Mal wirst du eventuell erneut gefragt."));
    else if (username) setNotice(t("Username updated.", "Benutzername aktualisiert."));
  }
  function selectStartupEngine(engine: ChatEngine) {
    if (busyRef.current || clearingModelCache) return;
    setChatEngine(selectFirstRunEngine(engine, conversation));
  }
  function editStartupUsername() {
    if (busyRef.current || clearingModelCache) return;
    if (conversation.getSnapshot().status === "loading") conversation.unload();
    setEditingStartupUsername(true);
  }
  function completeStartup(choice: FirstRunChoice) {
    if (!username || busyRef.current || clearingModelCache) return;
    try {
      const previous = normalizeConversationSettings({ engine: chatEngine, modelId: selectedChatModel, cpuExplicitChoice, hardwareBudget: deviceBudget, pausePhoneInBackground, gpuPreference });
      const result = finishFirstRun(username, choice, conversation, previous);
      setChatEngine(result.settings.engine); setSelectedChatModel(result.settings.modelId); setCpuExplicitChoice(result.settings.cpuExplicitChoice);
      setUsernamePersisted(result.profilePersisted); setStartupChoicePersisted(result.persisted); setNeedsModelSetup(false); setEditingStartupUsername(false);
      if (!result.persisted) setNotice(t("Your setup is active for this visit, but could not be fully saved. You may be asked to finish setup again next time.", "Deine Einrichtung gilt für diesen Besuch, konnte aber nicht vollständig gespeichert werden. Beim nächsten Mal wirst du eventuell erneut zur Einrichtung aufgefordert."));
      else if (choice.engine === "chat" && choice.loadLater) setNotice(t("Model selected. Open AI setup to load it before chatting.", "Modell gewählt. Öffne das AI-Setup und lade es vor dem Chatten."));
      else setNotice(choice.engine === "tools" ? t("Your built-in local assistant is ready for supported tasks.", "Dein integrierter lokaler Assistent ist für unterstützte Aufgaben bereit.") : t("Your local AI model is ready to chat.", "Dein lokales AI-Modell ist bereit zum Chatten."));
      requestAnimationFrame(() => textarea.current?.focus());
    } catch (failure) { setNotice(conversationError(errorMessage(failure), locale)); }
  }
  function reviewStartupChoice() {
    if (!username || busyRef.current || readingFiles || clearingModelCache) return;
    const result = saveUserProfile(username, undefined, { setupPending: true });
    setUsernamePersisted(result.persisted); setStartupChoicePersisted(false); setNeedsModelSetup(true); setEditingStartupUsername(false); setModal(null); stopListening(); stopSpeech();
  }
  function persistDrafts() {
    if (!workspaceStorage.current.writable || !draftStorage.current.writable) return;
    const saved = draftStorage.current.save(draftsRef.current); setDraftSaveFailed(!saved);
    if (!saved && !storageWarning.current) { storageWarning.current = true; setNotice(t("Drafts could not be saved in browser storage. Keep a copy of important text.", "Entwürfe konnten nicht im Browserspeicher gespeichert werden. Bewahre wichtigen Text als Kopie auf.")); }
  }
  function retrySaving() {
    if (workspaceStorageIssue || draftStorageIssue) { setModal("settings"); return; }
    const saved = workspaceStorage.current.save({ chats, projects, activeProjectId, activeId, locale, autoSpeak, voiceId, collapsed, theme });
    setWorkspaceSaveFailed(!saved); stashDraft();
  }
  function replaceSavedWorkspace(): boolean {
    if (busyRef.current || !workspaceStorageIssue) return false;
    if (!workspaceStorage.current.replace({ chats, projects, activeProjectId, activeId, locale, autoSpeak, voiceId, collapsed, theme })) {
      setNotice(t("Storage is still unavailable or full. Saved data has not been replaced.", "Der Speicher ist weiterhin nicht verfügbar oder voll. Gespeicherte Daten wurden nicht ersetzt.")); return false;
    }
    draftsRef.current = updateDraft(draftsRef.current, activeId, { text: prompt, attachments, mode, engine: chatEngine });
    const draftsSaved = draftStorage.current.replace(draftsRef.current);
    setWorkspaceStorageIssue(null); setWorkspaceSaveFailed(false); setDraftSaveFailed(!draftsSaved);
    setDraftStorageIssue(previous => draftsSaved ? null : previous || { kind: "unavailable", raw: null });
    storageWarning.current = !draftsSaved;
    setNotice(draftsSaved ? t("Workspace saving restored.", "Workspace-Speicherung wiederhergestellt.") : t("Workspace saved. Drafts could not be saved; keep a copy of important text.", "Workspace gespeichert. Entwürfe konnten nicht gespeichert werden; bewahre wichtigen Text als Kopie auf."));
    return true;
  }
  function downloadOriginalWorkspace() {
    downloadRecoveryData(workspaceStorageIssue?.raw, "aelvor-workspace-recovery.txt");
  }
  function downloadRecoveryData(raw: string | null | undefined, filename: string) {
    if (raw == null) return;
    try { downloadText(raw, filename, "text/plain"); }
    catch { setNotice(t("Download could not start. Browser download permission may be required.", "Der Download konnte nicht gestartet werden. Möglicherweise ist eine Browser-Berechtigung erforderlich.")); }
  }
  function replaceSavedDrafts(): boolean {
    if (busyRef.current || !draftStorageIssue || !workspaceStorage.current.writable) return false;
    draftsRef.current = updateDraft(draftsRef.current, activeId, { text: prompt, attachments, mode, engine: chatEngine });
    if (!draftStorage.current.replace(draftsRef.current)) {
      setDraftSaveFailed(true); setNotice(t("Saved drafts could not be replaced. Keep a copy of unsent text.", "Gespeicherte Entwürfe konnten nicht ersetzt werden. Bewahre eine Kopie von ungesendetem Text auf.")); return false;
    }
    setDraftStorageIssue(null); setDraftSaveFailed(false);
    setNotice(t("Draft saving restored.", "Speicherung von Entwürfen wiederhergestellt.")); return true;
  }
  function stashDraft() { draftsRef.current = updateDraft(draftsRef.current, activeId, { text: prompt, attachments, mode, engine: chatEngine }); persistDrafts(); }
  function restoreDraft(chatId: string | null) {
    const draft = draftsRef.current.find(item => item.chatId === chatId);
    setPrompt(draft?.text || ""); setAttachments(draft?.attachments || []);
    if (draft) { setMode(draft.mode); setChatEngine(draft.engine); }
  }
  function discardDraft() { draftAutosave.current.invalidate(); stopListening(); cancelAttachmentRead(); draftsRef.current = removeDraft(draftsRef.current, activeId); persistDrafts(); setPrompt(""); setAttachments([]); }
  function clearConversationHistory() {
    if (busyRef.current) return;
    draftAutosave.current.invalidate(); stopListening(); cancelAttachmentRead();
    draftsRef.current = []; persistDrafts(); setChats([]); setActiveId(null); setPrompt(""); setAttachments([]); setConfirmClear(false); stopSpeech();
    setNotice(t("Conversation history cleared.", "Gesprächsverlauf gelöscht."));
  }
  function deleteConversation() {
    if (busyRef.current || !deleteId) return;
    if (activeId === deleteId) { draftAutosave.current.invalidate(); stopListening(); cancelAttachmentRead(); }
    setChats(previous => previous.filter(chat => chat.id !== deleteId));
    draftsRef.current = removeDraft(draftsRef.current, deleteId); persistDrafts();
    if (activeId === deleteId) { setActiveId(null); restoreDraft(null); }
    stopSpeech(); setDeleteId(null); closeModal();
  }
  function selectProject(id: string | null) { newChat(); setActiveProjectId(id); }
  function editProject(project?: Project) { setProjectEditingId(project?.id || null); setProjectTitle(project?.name || ""); setProjectError(""); setModal("project"); }
  function commitProject() {
    try {
      const id = projectEditingId || uid();
      setProjects(saveProject(projects, projectTitle, id));
      if (!projectEditingId) selectProject(id); else closeModal();
    } catch (error) { setProjectError(error instanceof Error ? error.message : "project_name"); }
  }
  function deleteProject() {
    if (!projectEditingId) return;
    const next = removeProject(projects, chats, projectEditingId); setProjects(next.projects); setChats(next.chats);
    if (activeProjectId === projectEditingId) setActiveProjectId(null);
    closeModal();
  }
  function moveToProject(id: string | null) {
    if (current) setChats(previous => previous.map(chat => chat.id === current.id ? { ...chat, projectId: id || undefined } : chat));
    setActiveProjectId(id);
  }
  function saveAssistantSettings(value: AssistantPreferences) {
    const normalized = normalizeAssistantPreferences(value); setAssistantPreferences(normalized);
    const persisted = writeAssistantPreferences(normalized); setAssistantPreferencesPersisted(persisted);
    setNotice(persisted ? t("AI preferences saved for new replies.", "AI-Präferenzen für neue Antworten gespeichert.") : t("Preferences apply to this visit but could not be saved.", "Präferenzen gelten für diesen Besuch, konnten aber nicht gespeichert werden."));
    return persisted;
  }
  function stopSpeech() { speakingToken.current++; utteranceRef.current = null; speechOutputRef.current?.cancel(); setSpeakingId(null); }
  function stopListening() { recognitionRef.current.cancel(); setListening(false); }
  function changeKnowledge(documents: KnowledgeDocument[]): boolean {
    try { const next = validateKnowledgeDocuments(documents); const persisted = writeKnowledgeLibrary(next); setKnowledgeDocuments(next); setKnowledgePersisted(persisted); setKnowledgeLoadError(false); return persisted; }
    catch { setNotice(t("Knowledge could not be changed. Check the library limits.", "Wissen konnte nicht geändert werden. Prüfe die Bibliotheksgrenzen.")); return false; }
  }
  function changeCodeProjects(projects: CodeProject[]): boolean {
    try {
      const next = validateCodeProjects(projects); codeProjectsRef.current = next; codeProjectsDirty.current = true;
      setCodeProjects(next); setCodeProjectsStatus("pending"); setCodeProjectsLoadError(false); return true;
    } catch (error) { setNotice(projectErrorText(error, locale)); return false; }
  }
  function retryCodeProjectsSave() {
    const saved = writeCodeProjects(codeProjectsRef.current); codeProjectsDirty.current = !saved;
    setCodeProjectsStatus(saved ? "saved" : "failed");
  }
  function prepareCodeProjectRequest(project: CodeProject, instruction: string, file?: string): boolean {
    if (busyRef.current) { setNotice(t("Wait for the current reply to finish, then prepare your project request.", "Warte auf das Ende der aktuellen Antwort und bereite dann deine Projektanfrage vor.")); return false; }
    try {
      const budget = conversation.characterBudget - assistantPreferencePrompt(assistantPreferences).length;
      const next = appendCodeProjectRequest(prompt, project, instruction, file, locale, budget);
      stopListening(); setPrompt(next); setMode("build"); setChatEngine("chat"); setModal(null); setSidebar(false);
      setNotice(t("Project context added to your draft. Review it, then send to your loaded AI model.", "Projektkontext zum Entwurf hinzugefügt. Prüfe ihn und sende ihn dann an dein geladenes AI-Modell."));
      requestAnimationFrame(() => textarea.current?.focus()); return true;
    } catch { setNotice(t("There is not enough model context for this request. Shorten your chat draft or instructions, then try again. Your draft was preserved.", "Der Modellkontext reicht für diese Anfrage nicht aus. Kürze den Chat-Entwurf oder die Anweisung und versuche es erneut. Dein Entwurf bleibt erhalten.")); return false; }
  }
  function prepareTerminalRequest(result: WindowsResult): boolean {
    if (busyRef.current) { setNotice(t("Wait for the current reply before preparing terminal context.", "Warte auf die aktuelle Antwort, bevor du Terminalkontext vorbereitest.")); return false; }
    try {
      const separator = prompt.trim() ? "\n\n" : "", budget = conversation.characterBudget - assistantPreferencePrompt(assistantPreferences).length - prompt.length - separator.length;
      const context = terminalAiContext(result, budget, locale); stopListening(); setPrompt(prompt + separator + context); setMode("investigate"); setChatEngine("chat"); setModal(null); setSidebar(false);
      setNotice(t("Reviewed terminal output added to your draft. Check it, then send to your loaded model.", "Geprüfte Terminalausgabe zum Entwurf hinzugefügt. Prüfe sie und sende sie an dein geladenes Modell.")); requestAnimationFrame(() => textarea.current?.focus()); return true;
    } catch { setNotice(t("There is not enough context for the terminal result. Shorten your draft or copy a smaller excerpt; your draft is preserved.", "Der Kontext reicht für das Terminalergebnis nicht aus. Kürze den Entwurf oder kopiere einen kleineren Auszug; dein Entwurf bleibt erhalten.")); return false; }
  }
  function cancelAttachmentRead() { attachmentLoading.current?.abort(); attachmentLoading.current = null; setReadingFiles(false); }
  function changeLocale(next: Locale) { stopListening(); stopSpeech(); setLocale(next); if (voiceId && !voices.some(voice => voice.voiceURI === voiceId && voice.lang.startsWith(next))) setVoiceId(""); }
  function closeModal() { setModal(null); setConfirmClear(false); }
  function newChat() {
    draftAutosave.current.invalidate(); stashDraft();
    if (busyRef.current) abortRef.current?.abort();
    setModal(null); setConfirmClear(false);
    stopSpeech(); stopListening(); cancelAttachmentRead(); setActiveId(null); restoreDraft(null); setSidebar(false); setModeOpen(false); setAtBottom(true); setFocusedMessage(null); setSelectedArtifact(null); setExtraArtifact(null);
    requestAnimationFrame(() => textarea.current?.focus());
  }
  function selectChat(id: string, messageId?: string) { draftAutosave.current.invalidate(); stashDraft(); abortRef.current?.abort(); stopListening(); cancelAttachmentRead(); setActiveId(id); if (activeProjectId && chats.find(chat => chat.id === id)?.projectId !== activeProjectId) setActiveProjectId(chats.find(chat => chat.id === id)?.projectId || null); setSidebar(false); setModal(null); setAtBottom(!messageId); setFocusedMessage(messageId ? { id: messageId } : null); restoreDraft(id); setSelectedArtifact(null); setExtraArtifact(null); stopSpeech(); }
  function renameChat(chat: Chat) { setRenameId(chat.id); setRenameTitle(chat.title); setModal("rename"); }
  function editQuestion(message: Message) {
    if (!current || busyRef.current) return;
    setEditSource({ chatId: current.id, questionId: message.id }); setEditText(message.content); setModal("edit");
  }
  function importConversations(backup: ConversationBackup): boolean {
    if (busyRef.current) return false;
    if (!workspaceStorage.current.writable) { setNotice(t("Resolve saved workspace recovery in Settings before importing a backup.", "Stelle den gespeicherten Workspace in den Einstellungen wieder her, bevor du eine Sicherung importierst.")); return false; }
    try {
      const merged = mergeConversationBackup(chats, backup, uid, projects);
      // Persist first: a full browser store must not produce a successful import
      // that disappears after refresh. Existing history is never overwritten.
      if (!workspaceStorage.current.save({ chats: merged.chats, projects: merged.projects, activeProjectId, activeId, locale, autoSpeak, voiceId, collapsed, theme })) { setWorkspaceSaveFailed(true); throw Error("workspace_save"); }
      setWorkspaceSaveFailed(false);
      setChats(merged.chats); setProjects(merged.projects);
      setNotice(t(`Added ${merged.added} conversations and ${merged.projectsAdded} projects · ${merged.skipped} identical copies skipped.`, `${merged.added} Gespräche und ${merged.projectsAdded} Projekte hinzugefügt · ${merged.skipped} identische Kopien übersprungen.`));
      return true;
    } catch (error) {
      setNotice(error instanceof Error && error.message === "backup_too_large" ? t("The combined history exceeds the import limits. Import a smaller backup.", "Der kombinierte Verlauf überschreitet die Importgrenzen. Importiere eine kleinere Sicherung.") : t("Import could not be saved. Free browser storage and try again; existing conversations are still available.", "Der Import konnte nicht gespeichert werden. Gib Browserspeicher frei und versuche es erneut; vorhandene Gespräche bleiben verfügbar."));
      return false;
    }
  }
  function openStudio(tab: StudioTab = "tools") { setArtifactIntent("code"); setArtifactRequest(value => value + 1); setStudioTab(tab); setStudioOpen(true); setSidebar(false); }
  function openArtifact(language: string, content: string, intent: "code" | "preview" | "project" = "code", messageId?: string) {
    const match = artifacts.find(item => item.kind === "code" && item.content === content && (!messageId || item.messageId === messageId));
    const artifact: Artifact = match || { id: `excerpt:${uid()}`, title: t("Code from this conversation", "Code aus diesem Gespräch"), filename: `aelvor-code.${codeExtension(language)}`, language, content, kind: "code", demo: false };
    if (intent === "project") {
      try {
        const project = codeProjectFromArtifacts(artifact, artifacts, uid());
        setPendingCodeImport(project); setModal("code-projects"); setSidebar(false);
      } catch (error) {
        setNotice(error instanceof Error && error.message === "code_project_patch" ? t("Request complete files with filename=relative/path.ext. Unified diffs cannot replace project files directly.", "Bitte um vollständige Dateien mit filename=relativer/pfad.ext. Unified Diffs können Projektdateien nicht direkt ersetzen.") : projectErrorText(error, locale));
      }
      return;
    }
    if (!match) setExtraArtifact(artifact);
    setSelectedArtifact(artifact.id); openStudio("artifacts"); setArtifactIntent(intent);
  }
  function toggleNavigation() { if (window.innerWidth <= 760) setSidebar(!sidebar); else setCollapsed(!collapsed); }
  function updateMessage(chatId: string, messageId: string, patch: Partial<Message>) {
    setChats(previous => previous.map(chat => chat.id === chatId ? { ...chat, messages: chat.messages.map(message => message.id === messageId ? { ...message, ...patch } : message) } : chat));
  }
  function unloadConversation() { conversation.unload(); }
  function selectGpuPreference(value: GpuPreference) {
    if (busyRef.current || conversation.getSnapshot().status === "loading" || clearingModelCache) return;
    const next = normalizeGpuPreference(value);
    if (next === gpuPreference) return;
    const active = conversation.getSnapshot().modelId;
    if (active && !getCpuModel(active)) conversation.unload();
    setGpuPreference(next);
    setNotice(t("GPU requirement updated. Check the GPU and load the selected model when ready.", "GPU-Anforderung aktualisiert. Prüfe die GPU und lade das gewählte Modell bei Bedarf."));
  }
  function selectConversationModel(modelId: string) {
    const selection = selectedRuntimePreference(modelId);
    setSelectedChatModel(selection.modelId); setCpuExplicitChoice(selection.cpuExplicitChoice);
  }
  async function activateConversation() {
    if (busyRef.current || conversation.getSnapshot().status === "loading" || clearingModelCache) return;
    setChatEngine("chat");
    try {
      await conversation.load(selectedChatModel);
      setNotice(needsModelSetup ? t("Local response tested. Continue into your workspace when ready.", "Lokale Antwort getestet. Öffne deinen Workspace, wenn du bereit bist.") : t("AI Chat is ready. Close the panel and send your question.", "AI-Chat ist bereit. Schließe das Fenster und sende deine Frage."));
    } catch { /* The session state exposes load errors; cancelled loads stay idle. */ }
  }

  async function clearConversationCache() {
    if (busyRef.current || conversation.getSnapshot().status === "loading" || clearingModelCache) return;
    setClearingModelCache(true);
    if (conversation.getSnapshot().modelId === selectedChatModel) unloadConversation();
    try {
      const cpuModel = getCpuModel(selectedChatModel);
      if (cpuModel) {
        const { clearCpuCache } = await import("../lib/cpu-cache"); await clearCpuCache(cpuModel);
      } else {
        const { deleteConversationCache } = await import("../lib/browser-conversation"); await deleteConversationCache(selectedChatModel);
      }
      setNotice(t("Downloaded files for this model were removed. Chat history is unchanged.", "Heruntergeladene Dateien für dieses Modell wurden entfernt. Der Gesprächsverlauf bleibt erhalten."));
    } catch { setNotice(t("Cached model files could not be removed. Check browser storage settings.", "Gespeicherte Modelldateien konnten nicht entfernt werden. Prüfe die Browserspeicher-Einstellungen.")); }
    finally { setClearingModelCache(false); }
  }
  function chooseTemplate(id: string) {
    const request = playbookRequest(id, locale);
    if (!request) return;
    stopListening(); setPrompt(request.text); setMode(request.mode); setChatEngine(request.engine); setModal(null); setSidebar(false);
    requestAnimationFrame(() => textarea.current?.focus());
  }

  function speak(text: string, id: string, language = locale) {
    if (!voiceAvailable) { setNotice(t("Speech output is not supported by this browser.", "Dieser Browser unterstützt keine Sprachausgabe.")); return; }
    stopSpeech();
    const token = speakingToken.current;
    const chunks = speechChunks(text, language);
    const matchingVoice = voices.find(voice => voice.voiceURI === voiceId && voice.lang.startsWith(language)) || voices.find(voice => voice.lang.startsWith(language));
    setSpeakingId(id);
    let index = 0;
    const play = () => {
      if (speakingToken.current !== token) return;
      if (index >= chunks.length) { utteranceRef.current = null; setSpeakingId(null); return; }
      try {
        const output = speechOutputRef.current;
        if (!output) throw new Error("speech_output_unavailable");
        const utterance = new SpeechSynthesisUtterance(chunks[index++]);
        utteranceRef.current = utterance;
        utterance.lang = language === "de" ? "de-DE" : "en-US";
        if (matchingVoice) utterance.voice = matchingVoice;
        utterance.rate = 1;
        utterance.onend = () => { if (speakingToken.current === token) { utteranceRef.current = null; play(); } };
        utterance.onerror = event => { if (speakingToken.current === token) { utteranceRef.current = null; setSpeakingId(null); if (event.error !== "canceled" && event.error !== "interrupted") setNotice(t("Voice playback could not start. Check your browser's audio settings.", "Die Sprachausgabe konnte nicht starten. Prüfe die Audioeinstellungen deines Browsers.")); } };
        output.speak(utterance);
      } catch { utteranceRef.current = null; setSpeakingId(null); setNotice(t("Voice playback could not start.", "Die Sprachausgabe konnte nicht starten.")); }
    };
    play();
  }

  function startListening(autoSend = false) {
    if (busyRef.current || attachmentLoading.current) return;
    if (autoSend && chatEngine === "chat" && !conversation.ready) { setModal("ai"); return; }
    if (recognitionRef.current.running) { recognitionRef.current.stop(); return; }
    stopSpeech(); setTranscript("");
    const create = recognitionFactory(() => window);
    if (!create) { setNotice(t("Speech recognition is unavailable. Use a browser that supports voice input.", "Spracherkennung ist nicht verfügbar. Nutze einen Browser mit Spracheingabe.")); return; }
    recognitionRef.current.start(create, locale, {
      onListening: setListening,
      onTranscript: value => { setTranscript(value); if (!autoSend) setPrompt(value); },
      onComplete: value => { if (autoSend) void send(value, true); },
      onError: code => {
        if (code !== "aborted") setNotice(code === "not-allowed" ? t("Microphone permission was denied. Allow it in your browser to use voice input.", "Der Mikrofonzugriff wurde verweigert. Erlaube ihn im Browser für die Spracheingabe.") : t("No speech could be captured. Check your microphone and try again.", "Es wurde keine Sprache erfasst. Prüfe dein Mikrofon und versuche es erneut."));
      },
    });
  }

  async function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || []); event.target.value = "";
    if (!selected.length || busyRef.current || attachmentLoading.current) return;
    if (attachments.length + selected.length > 3) { setNotice(t("Attach up to 3 text files at a time.", "Füge höchstens 3 Textdateien gleichzeitig hinzu.")); return; }
    const controller = new AbortController(); attachmentLoading.current = controller; setReadingFiles(true);
    const errors: Record<string, string> = {
      file_too_large: t("Each file must be smaller than 100 KB.", "Jede Datei muss kleiner als 100 KB sein."),
      unsupported_file: t("Choose a text, code, configuration, or log file.", "Wähle eine Text-, Code-, Konfigurations- oder Logdatei."),
      binary_file: t("Binary files are not supported.", "Binärdateien werden nicht unterstützt."),
      file_read_failed: t("A file could not be read. Please try again.", "Eine Datei konnte nicht gelesen werden. Bitte erneut versuchen."),
    };
    try {
      const result = await readAttachments(selected, { signal: controller.signal, onReject: code => setNotice(errors[code]) });
      if (!controller.signal.aborted) setAttachments(previous => [...previous, ...result.map(file => ({ ...file, id: uid() }))].slice(0, 3));
    } catch (failure) { if (!controller.signal.aborted) setNotice(errorMessage(failure, errors.file_read_failed)); }
    finally { if (attachmentLoading.current === controller) { attachmentLoading.current = null; setReadingFiles(false); } }
  }

  async function send(override?: string, fromVoice = false, branch?: BranchSource) {
    const continuing = Boolean(branch && "responseId" in branch);
    const engine = continuing ? "chat" : chatEngine;
    const text = (override ?? prompt).trim();
    const sourceChat = branch ? chats.find(chat => chat.id === branch.chatId) : undefined;
    const sourceQuestion = branch && "questionId" in branch ? sourceChat?.messages.find(message => message.id === branch.questionId && message.role === "user") : undefined;
    if (branch && (!sourceChat || ("questionId" in branch && !sourceQuestion))) { setNotice(t("The original question is no longer available.", "Die ursprüngliche Frage ist nicht mehr verfügbar.")); return; }
    const files = branch ? sourceQuestion?.attachments || [] : attachments;
    if (busyRef.current || (!text && !files.length)) return;
    if (attachmentLoading.current) { setNotice(t("Wait for the selected files to finish loading.", "Warte, bis die ausgewählten Dateien geladen sind.")); return; }
    const content = text || t("Please review the attached file.", "Bitte prüfe die angehängte Datei.");
    let branched: ReturnType<typeof branchQuestion> | undefined;
    try { if (branch && sourceChat) branched = "questionId" in branch ? branchQuestion(sourceChat, branch.questionId, content, uid) : branch.intent === "refine" ? branchRefinement(sourceChat, branch.responseId, content, uid) : branchContinuation(sourceChat, branch.responseId, content, uid); }
    catch { setNotice(t("This response is no longer available for a new branch.", "Diese Antwort ist nicht mehr für einen neuen Zweig verfügbar.")); return; }
    const previousMessages = branched?.history || current?.messages || [];
    let selectedKnowledge: KnowledgeExcerpt[] = [];
    if (engine === "chat") {
      try { selectedKnowledge = prepareConversation({ text: content, files, history: previousMessages, locale, mode, preserveLastPair: continuing, preferences: assistantPreferences, characterBudget: conversation.characterBudget, knowledge: knowledgeDocuments }).knowledge; }
      catch (failure) { setNotice(conversationError(errorMessage(failure), locale)); return; }
    }
    if (engine === "chat" && !conversation.ready) { setChatEngine(engine); if (!branch) setPrompt(text); setModal("ai"); setNotice(t("Load a model, then try your question again.", "Lade ein Modell und versuche deine Frage erneut.")); return; }
    if (text.length > 20000) { setNotice(t("Please keep your message below 20,000 characters.", "Bitte halte deine Nachricht unter 20.000 Zeichen.")); return; }
    draftAutosave.current.invalidate();
    setChatEngine(engine); busyRef.current = true; setBusy(true); stopListening(); stopSpeech();
    const speechScope = speakingToken.current;
    const chatId = branched?.chat.id || activeId || uid(), responseId = uid();
    const message: Message = branched ? { ...branched.question, language: locale } : { id: uid(), role: "user", content, attachments: [...files], language: locale };
    const responseMessage: Message = { id: responseId, role: "assistant", content: "", pending: true, local: true, language: locale, kind: engine === "chat" ? "conversation" : undefined, model: engine === "chat" ? activeChatModelName : undefined, ...(selectedKnowledge.length ? { knowledge: selectedKnowledge } : {}) };
    const nextMessages = [...previousMessages, message, responseMessage];
    if (branched) {
      stashDraft(); setActiveProjectId(branched.chat.projectId || null);
      setChats(previous => [{ ...branched.chat, messages: nextMessages }, ...previous]);
      setSelectedArtifact(null); setExtraArtifact(null); setFocusedMessage(null); setModal(null); setEditSource(null);
      setNotice(t("A new branch is open. Your original conversation is preserved.", "Ein neuer Zweig ist geöffnet. Dein ursprüngliches Gespräch bleibt erhalten."));
    } else if (current) setChats(previous => previous.map(chat => chat.id === chatId ? { ...chat, messages: nextMessages, updatedAt: Date.now() } : chat));
    else setChats(previous => [{ id: chatId, title: text.replace(/\n/g, " ").slice(0, 55) || files[0]?.name || "Conversation", updatedAt: Date.now(), projectId: activeProjectId || undefined, messages: nextMessages }, ...previous]);
    setActiveId(chatId); if (!branch) { draftsRef.current = removeDraft(draftsRef.current, activeId); persistDrafts(); setPrompt(""); setAttachments([]); } else restoreDraft(chatId); setAtBottom(true); setModeOpen(false);
    const controller = new AbortController(); abortRef.current = controller;
    let partial = "", lastRendered = 0;
    try {
      if (engine === "chat") {
        const response = await conversation.generate({
          text: message.content, locale, mode, files: message.attachments, history: previousMessages, signal: controller.signal, preserveLastPair: continuing, preferences: assistantPreferences, knowledge: knowledgeDocuments,
          onPhase: phase => setGenerationPhase({ id: responseId, phase }),
          onDraft: content => { partial = content; },
          onText: content => {
            partial = content;
            if (performance.now() - lastRendered > 70 || !lastRendered) { updateMessage(chatId, responseId, { content }); lastRendered = performance.now(); }
          },
        });
        updateMessage(chatId, responseId, { content: response.text, pending: false, language: response.language, kind: "conversation", contextShortened: response.contextShortened, finishReason: response.finishReason, metrics: response.metrics, knowledge: response.knowledge, quality: response.quality, steps: ["build-conversation-context", ...(response.knowledge.length ? ["retrieve-local-knowledge"] : []), "generate-on-device"] });
        if ((autoSpeak || fromVoice) && speakingToken.current === speechScope) speak(response.text, responseId, response.language);
      } else {
        const response = await runLocalAgent({ text: message.content, locale, mode, files: message.attachments, history: previousMessages, preferences: assistantPreferences, knowledge: knowledgeDocuments, bundle: modelBundle || undefined, signal: controller.signal, train: (examples, name) => trainInWorker(examples, name, { signal: controller.signal }) });
        if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
        updateMessage(chatId, responseId, { content: response.text, pending: false, local: true, steps: response.steps, kind: response.kind, language: response.language || locale, knowledge: response.knowledge || [] });
        if (response.bundle) { setModelBundle(response.bundle); openStudio("model"); }
        if ((autoSpeak || fromVoice) && speakingToken.current === speechScope) speak(response.text, responseId, response.language || locale);
      }
    } catch (failure) {
      if (controller.signal.aborted) updateMessage(chatId, responseId, { content: partial || t("Response stopped.", "Antwort gestoppt."), pending: false, stopped: true });
      else {
        const code = errorMessage(failure);
        const errors: Record<string, string> = {
          invalid_url: t("Enter a complete HTTP or HTTPS URL.", "Gib eine vollständige HTTP- oder HTTPS-URL ein."),
          invalid_json: t("The supplied JSON could not be parsed. Check quotes, commas, and brackets.", "Das übergebene JSON konnte nicht gelesen werden. Prüfe Anführungszeichen, Kommas und Klammern."),
          dataset_excerpt: t("The training attachment is truncated. Paste the full dataset in Model lab before training.", "Der Trainingsanhang ist gekürzt. Füge den vollständigen Datensatz vor dem Training im Model-Lab ein."),
          dataset_size: t("Model training requires 8–500 labeled examples.", "Modelltraining benötigt 8–500 beschriftete Beispiele."),
          dataset_labels: t("Use 2–12 labels and at least 2 examples per label.", "Nutze 2–12 Klassen und mindestens 2 Beispiele pro Klasse."),
          dataset_unique: t("After deduplication, use at least 8 unique examples and 2 per label.", "Nutze nach der Deduplizierung mindestens 8 eindeutige Beispiele und 2 pro Klasse."),
          conflicting_labels: t("Identical texts have conflicting labels. Correct them in Model lab.", "Identische Texte haben widersprüchliche Klassen. Korrigiere sie im Model-Lab."),
          worker_unavailable: t("Your browser does not support background training. Try a current browser.", "Dein Browser unterstützt kein Hintergrundtraining. Nutze einen aktuellen Browser."),
          training_failed: t("Background training failed. Try again in Model lab.", "Hintergrundtraining fehlgeschlagen. Versuche es erneut im Model-Lab."),
          invalid_dataset: t("Each training example needs a label and text. Check the dataset in Model lab.", "Jedes Trainingsbeispiel benötigt eine Klasse und Text. Prüfe den Datensatz im Model-Lab."),
          secure_context_required: t("SHA-256 requires HTTPS. Use the published workspace.", "SHA-256 benötigt HTTPS. Nutze den veröffentlichten Workspace."),
          input_too_long: t("Use a shorter text excerpt for this local operation.", "Nutze einen kürzeren Textauszug für diese lokale Operation."),
          too_long: t("Use a shorter text excerpt for this local operation.", "Nutze einen kürzeren Textauszug für diese lokale Operation."),
        };
        const explanation = engine === "chat" ? conversationError(code, locale) : errors[code] || t("The local operation could not finish. Check the input format and try again.", "Die lokale Operation konnte nicht abgeschlossen werden. Prüfe das Eingabeformat und versuche es erneut.");
        updateMessage(chatId, responseId, { content: partial ? `${partial}\n\n---\n${explanation}` : explanation, pending: false, error: true, local: true });

      }
    } finally { busyRef.current = false; setBusy(false); abortRef.current = null; setGenerationPhase(null); }
  }

  function regenerate(message: Message) {
    if (!current || busyRef.current) return;
    const question = questionForResponse(current, message.id);
    if (question) void send(question.content, false, { chatId: current.id, questionId: question.id });
  }

  function exportChat() {
    if (!current) return;
    downloadText(`# ${current.title}\n\n${current.messages.map(message => `## ${message.role === "user" ? username || t("You", "Du") : "AELVOR"}${message.model ? ` (${message.model}, on-device AI)` : message.local ? " (Local tools)" : ""}${message.demo ? " (Demo)" : ""}${message.stopped || message.error ? " (Incomplete)" : ""}\n\n${attributeMarkdown(message.content)}${(message.attachments || []).map(file => `\n\n### ${file.name}${file.truncated ? " (excerpt)" : ""}\n\n${file.content}`).join("")}${message.knowledge?.length ? `\n\n### ${t("Knowledge context selected", "Ausgewählter Wissenskontext")}\n\n${message.knowledge.map(source => `[${source.reference}] ${source.title} (${t("lines", "Zeilen")} ${source.startLine}–${source.endLine}; ${source.sourceDate || t("undated", "undatiert")}${source.retrievedAt !== undefined ? `; ${t("retrieved", "abgerufen")} ${new Date(source.retrievedAt).toISOString()}` : ""})${source.sourceUrl ? `\n${source.sourceUrl}` : ""}\n${source.text.split("\n").map(line => `> ${line}`).join("\n")}`).join("\n\n")}` : ""}`).join("\n\n---\n\n")}\n\n${COPYRIGHT_NOTICE}`, `aelvor-conversation-${new Date().toISOString().slice(0, 10)}.md`, "text/markdown");
  }
  async function copyResponse(message: Message) { try { await navigator.clipboard.writeText(attributeMarkdown(message.content)); setJustCopied(message.id); setTimeout(() => setJustCopied(null), 2000); } catch { setNotice(t("Clipboard access is unavailable.", "Zugriff auf die Zwischenablage ist nicht verfügbar.")); } }
  function onComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }

  const composer = <div className={`composer-wrap ${isChat ? "in-chat" : ""}`}>
    {readingFiles && <div className="attachment-reading" role="status"><Loader2 size={12} className="spin"/>{t("Reading selected files…", "Ausgewählte Dateien werden gelesen…")}</div>}
    <details className="composer-options"><summary><SlidersHorizontal size={14}/><span>{t("Customize", "Anpassen")}</span><small>{t("Style, sources & project", "Stil, Quellen & Projekt")}</small><ChevronDown size={12}/></summary>
    <div className="composer-context"><label><span>{t("Project", "Projekt")}</span><select value={current?.projectId || activeProjectId || ""} onChange={event => moveToProject(event.target.value || null)} aria-label={t("Conversation project", "Gesprächsprojekt")}><option value="">{t("No project", "Ohne Projekt")}</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><button className={`composer-personalize ${assistantPreferences.style !== "balanced" || assistantPreferences.instructions || (assistantPreferences.approach && assistantPreferences.approach !== "auto") || (assistantPreferences.language && assistantPreferences.language !== "auto") || (assistantPreferences.format && assistantPreferences.format !== "auto") || (assistantPreferences.knowledge && assistantPreferences.knowledge !== "auto") || assistantPreferences.quality === "careful" ? "active" : ""}`} onClick={() => setModal("settings")} title={t("Personalize AI Chat in Settings", "AI-Chat in den Einstellungen anpassen")}><Sparkles size={12}/>{assistantPreferences.quality === "careful" ? t("Careful AI", "Sorgfältige AI") : assistantPreferences.approach === "precise" ? t("Precise", "Präzise") : assistantPreferences.approach === "creative" ? t("Creative", "Kreativ") : assistantPreferences.style === "concise" ? t("Concise", "Kurz") : assistantPreferences.style === "detailed" ? t("Detailed", "Ausführlich") : t("Adaptive AI", "Adaptive AI")}</button><button className={`composer-personalize ${assistantPreferences.knowledge !== "off" && knowledgeDocuments.some(item => item.enabled) ? "active" : ""}`} onClick={() => setModal("knowledge")} title={t("Manage sources available to AI Chat", "Für AI-Chat verfügbare Quellen verwalten")}><BookOpen size={12}/>{t("Knowledge", "Wissen")} · {knowledgeDocuments.filter(item => item.enabled).length}</button><button className="composer-personalize" onClick={() => setModal("code-projects")} title={t("Create or edit source projects", "Quellprojekte erstellen oder bearbeiten")}><FolderCode size={12}/>{t("Code projects", "Code-Projekte")}</button><button className={`composer-personalize ${showContext ? "active" : ""}`} aria-expanded={showContext} aria-controls="aelvor-context-inspector" onClick={event => { const next = !showContext; setShowContext(next); if (next) { const options = event.currentTarget.closest("details"); if (options) options.open = false; } }}><SlidersHorizontal size={12}/>{t("Context", "Kontext")}</button>{(prompt.length > 0 || attachments.length > 0) && <span className="draft-status">{t("Draft on this device", "Entwurf auf diesem Gerät")}<button disabled={busy} onClick={discardDraft}>{t("Discard", "Verwerfen")}</button></span>}</div>
    </details>
    {showContext && <ConversationContext engine={chatEngine} locale={locale} request={{ text: prompt.trim() || (attachments.length ? t("Please review the attached file.", "Bitte prüfe die angehängte Datei.") : ""), files: attachments, history: current?.messages || [], locale, mode, preferences: assistantPreferences, knowledge: knowledgeDocuments, characterBudget: conversation.characterBudget }} onClose={() => setShowContext(false)} onSettings={() => { setShowContext(false); setModal("settings"); }}/>}
    <div className={`composer ${listening && modal !== "voice" ? "recording" : ""}`}>
      {!!attachments.length && <div className="attachments">{attachments.map(file => <div key={file.id} className="attachment"><FileText size={15}/><span>{file.name}{file.truncated && <small>{t("Excerpt: first 12,000 characters", "Auszug: erste 12.000 Zeichen")}</small>}</span><button aria-label={t("Remove file", "Datei entfernen")} onClick={() => setAttachments(previous => previous.filter(item => item.id !== file.id))}><X size={13}/></button></div>)}</div>}
      <textarea ref={textarea} value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={onComposerKey} placeholder={listening ? t("Listening…", "Ich höre zu…") : chatEngine === "chat" ? t("Ask anything, or just start a conversation…", "Frag etwas oder beginne einfach ein Gespräch…") : t("What would you like to investigate or create?", "Was möchtest du analysieren oder erstellen?")} aria-label={t("Message AELVOR", "Nachricht an AELVOR")} rows={2} maxLength={chatEngine === "chat" ? 6000 : 20000} disabled={busy}/>
      <div className="composer-toolbar"><div className="composer-tools">
        <button className="icon-button attach-button" title={t("Attach text, code, or logs", "Text, Code oder Logs anhängen")} aria-label={t("Attach a file", "Datei anhängen")} onClick={() => fileInput.current?.click()} disabled={busy || readingFiles}><Plus size={20}/></button>
        <span className="tool-divider"/>
        <div className="mode-container"><button className="mode-button" aria-label={`${t("Response mode", "Antwortmodus")}: ${chatEngine === "chat" ? "AI Chat" : t("Local tools", "Lokale Tools")} · ${modeLabels[mode]}`} title={`${chatEngine === "chat" ? "AI Chat" : t("Local tools", "Lokale Tools")} · ${modeLabels[mode]}`} onClick={() => setModeOpen(!modeOpen)} aria-expanded={modeOpen} disabled={busy}><Sparkles size={13}/><span>{chatEngine === "chat" ? "AI Chat" : t("Local tools", "Lokale Tools")} <span className="mode-label">· {modeLabels[mode]}</span></span><ChevronDown size={13}/></button>
          {modeOpen && <><button className="dropdown-dismiss" aria-label={t("Close mode menu", "Modusmenü schließen")} onClick={() => setModeOpen(false)}/><div className="mode-menu"><span className="engine-menu-label">{t("RESPONSE ENGINE", "ANTWORTMOTOR")}</span><button onClick={() => { setChatEngine("chat"); setModeOpen(false); }}>AI Chat {chatEngine === "chat" && <Check size={14}/>}</button><button onClick={() => { setChatEngine("tools"); setModeOpen(false); }}>{t("Local tools", "Lokale Tools")} {chatEngine === "tools" && <Check size={14}/>}</button><div className="engine-menu-divider"/>{(["auto", "investigate", "build", "learn"] as AgentMode[]).map(item => <button key={item} onClick={() => { setMode(item); setModeOpen(false); }}>{modeLabels[item]}{mode === item && <Check size={14}/>}</button>)}</div></>}
        </div>
      </div><div className="composer-tools">
        <button className={`icon-button mic-button ${listening ? "active" : ""}`} aria-label={t("Dictate a message", "Nachricht diktieren")} title={t("Dictate a message", "Nachricht diktieren")} onClick={() => startListening()} disabled={busy || readingFiles}>{listening ? <Square size={15}/> : <Mic size={17}/>}</button>
        <button className="voice-button" onClick={() => setModal("voice")} title={t("Open voice conversation", "Sprachgespräch öffnen")} disabled={busy}><AudioLines size={17}/><span>{t("Voice", "Stimme")}</span></button>
        {busy ? <button className="send-button stop" aria-label={t("Stop response", "Antwort stoppen")} onClick={() => abortRef.current?.abort()}><Square size={14} fill="currentColor"/></button> : <button className="send-button" aria-label={t("Send message", "Nachricht senden")} onClick={() => void send()} disabled={readingFiles || (!prompt.trim() && !attachments.length)}><ArrowUp size={20}/></button>}
      </div></div>
    </div>
    <div className="composer-caption"><button className="composer-engine-status" onClick={() => setModal("ai")}><span className={`status-dot ${chatEngine === "tools" || conversationReady ? "live" : ""}`}/>{chatEngine === "tools" ? t("Local tools · Deterministic analysis", "Lokale Tools · Deterministische Analyse") : conversationReady ? `${activeProcessor} · ${activeChatModelName} · ${t("Can make mistakes", "Kann Fehler machen")}` : conversationState.status === "loading" ? t(`Loading AI · ${Math.round(conversationState.progress * 100)}%`, `AI wird geladen · ${Math.round(conversationState.progress * 100)}%`) : t("Activate AI for open conversation", "AI für offene Gespräche aktivieren")}</button><span className="keyboard-hint">↵ {t("Send", "Senden")}</span></div>
    <input type="file" ref={fileInput} multiple hidden accept=".txt,.log,.json,.csv,.tsv,.py,.js,.ts,.tsx,.jsx,.md,.sh,.yml,.yaml,.conf,.ini,.xml,.java,.go,.c,.cpp,.rs,.html,.css,.sql,.ps1" onChange={addFiles}/>
  </div>;

  const templateCards = <div className="template-grid">{templates.map(template => { const Icon = iconMap[template.icon]; return <button className="template-card" key={template.id} onClick={() => chooseTemplate(template.id)}><div className="template-card-top"><span className={`template-icon ${template.icon}`}><Icon size={18}/></span><ArrowRight className="template-arrow" size={16}/></div><span className="template-category">{template.category[locale]}</span><h3>{template.title[locale]}</h3><p>{template.description[locale]}</p></button>; })}</div>;

  if (!loaded) return <div className="loading-screen" role="status"><BrandMark/><span>AELVOR<span className="brand-period">.</span></span><small>Preparing your workspace · Workspace wird geladen</small><AppFooter locale={locale} className="loading-footer"/></div>;
  if (!username || editingStartupUsername) return <UsernameOnboarding locale={locale} onLocaleChange={changeLocale} onComplete={chooseUsername} initial={username || ""}/>;
  const aiSetupProps: ConversationSetupProps = { locale, state: conversationState, selected: selectedChatModel, budget: deviceBudget, onBudgetChange: setDeviceBudget, onSelect: selectConversationModel, onLoad: () => void activateConversation(), onCancel: unloadConversation, onUnload: unloadConversation, onDeleteCache: () => void clearConversationCache(), clearing: clearingModelCache, busy, pausePhoneInBackground, onPhonePauseChange: setPausePhoneInBackground, gpuPreference, onGpuPreferenceChange: selectGpuPreference };
  if (needsModelSetup) return <AiOnboarding {...aiSetupProps} username={username} usernamePersisted={usernamePersisted} engine={chatEngine} classifierName={modelBundle?.model.name} notice={notice} onLocaleChange={changeLocale} onEngineChange={selectStartupEngine} onBack={editStartupUsername} onFinish={completeStartup}/>;

  return <div className={`app-shell studio-v4 aelvor-modern ${collapsed ? "sidebar-collapsed" : ""} ${studioOpen ? "studio-open" : ""} ${studioOpen && studioTab === "artifacts" ? "artifact-studio" : ""}`} >
    {sidebar && <button className="sidebar-scrim" aria-label={t("Close navigation", "Navigation schließen")} onClick={() => setSidebar(false)}/>}
    <aside className={`sidebar ${sidebar ? "open" : ""}`}>
      <div className="sidebar-brand"><a href="/" aria-label={t("AELVOR home", "AELVOR Startseite")} onClick={event => { event.preventDefault(); newChat(); }} className="brand"><BrandMark/><span>AELVOR<span className="brand-period">.</span></span></a><span className="brand-version">AI</span><button className="icon-button collapse-button" onClick={() => { if (window.innerWidth <= 760) setSidebar(false); else setCollapsed(true); }} aria-label={t("Collapse navigation", "Navigation einklappen")}><PanelLeftClose size={17}/></button></div>
      <button className="new-chat" onClick={newChat} title={t("New conversation · Ctrl+Shift+O", "Neues Gespräch · Ctrl+Shift+O")}><Plus size={19}/><span className="new-chat-label">{t("New conversation", "Neues Gespräch")}</span><span className="new-chat-shortcut">↗</span></button>
      <div className="nav-group-label">{t("WORKSPACE", "WORKSPACE")}</div>
      <nav className="main-nav" aria-label={t("Main navigation", "Hauptnavigation")}>
        <button title={t("Search conversations · Ctrl+K", "Gespräche durchsuchen · Ctrl+K")} onClick={() => { setQuery(""); setModal("search"); }}><Search size={18}/><span>{t("Search conversations", "Gespräche durchsuchen")}</span><kbd>Ctrl K</kbd></button>
        <button title={t("AI model setup", "AI-Modelleinrichtung")} onClick={() => { setChatEngine("chat"); setModal("ai"); }}><Cpu size={17}/><span className="nav-action-label">AI Chat</span><span className="nav-new">{conversationReady ? "READY" : "SETUP"}</span></button>
        <button title={t("Knowledge library", "Wissensbibliothek")} onClick={() => setModal("knowledge")}><BookOpen size={17}/><span className="nav-action-label">{t("Knowledge library", "Wissensbibliothek")}</span>{knowledgeDocuments.length > 0 && <span className="nav-pill">{knowledgeDocuments.filter(item => item.enabled).length}</span>}</button>
        <button title={t("Code projects", "Code-Projekte")} onClick={() => { setModal("code-projects"); setSidebar(false); }}><FolderCode size={17}/><span className="nav-action-label">{t("Code projects", "Code-Projekte")}</span><span className="nav-pill">{codeProjects.length || "NEW"}</span></button>
        <details className="sidebar-tools"><summary title={t("More workspace tools", "Weitere Workspace-Tools")}><Layers3 size={17}/><span>{t("More tools", "Weitere Tools")}</span><ChevronDown size={13}/></summary><div className="main-nav sidebar-extra-nav" role="group" aria-label={t("Workspace tools", "Workspace-Tools")}>
        <button title={t("Windows terminal", "Windows-Terminal")} onClick={() => { setModal("terminal"); setSidebar(false); }}><Terminal size={17}/><span className="nav-action-label">{t("Windows terminal", "Windows-Terminal")}</span><span className="nav-new">PC</span></button>
        <button title={t("Playbooks", "Playbooks")} onClick={() => setModal("playbooks")}><BookOpen size={17}/><span className="nav-action-label">{t("Playbooks", "Playbooks")}</span><span className="nav-pill">4</span></button>
        <button title={t("Security lab", "Security-Lab")} className={studioOpen && studioTab === "tools" ? "nav-active" : ""} onClick={() => openStudio("tools")}><FlaskConical size={18}/><span className="nav-action-label">{t("Security lab", "Security-Lab")}</span><span className="nav-new">LOCAL</span></button>
        <button title={t("Artifacts", "Artefakte")} className={studioOpen && studioTab === "artifacts" ? "nav-active" : ""} onClick={() => openStudio("artifacts")}><Layers3 size={17}/><span className="nav-action-label">{t("Artifacts", "Artefakte")}</span>{artifacts.length > 0 && <span className="nav-pill">{artifacts.length}</span>}</button>
        <button title={t("Classifier lab", "Klassifikator-Lab")} className={studioOpen && studioTab === "model" ? "nav-active" : ""} onClick={() => openStudio("model")}><BrainCircuit size={18}/><span className="nav-action-label">{t("Classifier lab", "Klassifikator-Lab")}</span><span className="nav-new">TRAIN</span></button>
        <button title={t("Saved responses", "Gespeicherte Antworten")} onClick={() => setModal("saved")}><Star size={17}/><span className="nav-action-label">{t("Saved responses", "Gespeicherte Antworten")}</span>{saved.length > 0 && <span className="nav-pill">{saved.length}</span>}</button>
        </div></details>
      </nav>
      <div className="history-heading"><span>{activeProjectId ? projects.find(project => project.id === activeProjectId)?.name : t("YOUR CONVERSATIONS", "DEINE GESPRÄCHE")}</span><MessageSquare size={12}/></div>
      <div className="history-list"><ProjectNavigation projects={projects} chats={chats} selected={activeProjectId} locale={locale} onSelect={selectProject} onEdit={editProject} onCreate={() => editProject()}/>{orderedChats.length ? orderedChats.map(chat => <div className={`history-row ${activeId === chat.id ? "selected" : ""} ${chat.pinned ? "pinned" : ""}`} key={chat.id}>
        <button className="history-chat" onClick={() => selectChat(chat.id)} title={chat.title}>{chat.pinned ? <Pin size={13}/> : chat.sourceChatId ? <GitBranch size={14}/> : <MessageSquare size={14}/>}<span>{chat.title}</span></button>
        <div className="history-actions"><button className={chat.pinned ? "is-pinned" : ""} title={chat.pinned ? t("Unpin conversation", "Gespräch lösen") : t("Pin conversation", "Gespräch anheften")} aria-label={chat.pinned ? t("Unpin conversation", "Gespräch lösen") : t("Pin conversation", "Gespräch anheften")} aria-pressed={Boolean(chat.pinned)} onClick={() => setChats(previous => previous.map(item => item.id === chat.id ? { ...item, pinned: !item.pinned } : item))}><Pin size={12}/></button><button title={t("Rename conversation", "Gespräch umbenennen")} aria-label={t("Rename conversation", "Gespräch umbenennen")} onClick={() => renameChat(chat)}><Pencil size={12}/></button><button className="history-delete" title={t("Delete conversation", "Gespräch löschen")} aria-label={t("Delete conversation", "Gespräch löschen")} onClick={() => { setDeleteId(chat.id); setModal("delete"); }} disabled={busy}><Trash2 size={12}/></button></div>
      </div>) : <div className="history-empty"><span className="empty-history-line"/><p>{t("A fresh space for your next idea.", "Platz für deine nächste Idee.")}</p><small>{t("Your conversations will appear here.", "Deine Gespräche erscheinen hier.")}</small></div>}</div>
      <div className="sidebar-bottom"><div className="sidebar-feature"><div className="feature-icon"><Box size={20}/><span className="tiny-star">✦</span></div><span className="feature-tag">{t("AELVOR STUDIO", "AELVOR STUDIO")}</span><h3>{t("A useful tool. A clear next step.", "Mehr Möglichkeiten.")}</h3><p>{t("Your security toolkit, always close.", "Deine Sicherheitstools, immer griffbereit.")}</p><button onClick={() => openStudio("tools")}>{t("Explore the lab", "Das Lab entdecken")}<ArrowUp size={13}/></button></div>
        <button className="profile" aria-label={t("Workspace settings", "Workspace-Einstellungen")} onClick={() => setModal("settings")}><span className="avatar">{usernameInitials(username)}</span><span><strong>@{username}</strong><small><span className={`status-dot ${chatEngine === "tools" || conversationReady ? "live" : ""}`}/>{chatEngine === "tools" ? t("Local tools active", "Lokale Tools aktiv") : conversationReady ? t("AI Chat ready", "AI-Chat bereit") : t("AI Chat setup", "AI-Chat einrichten")}</small></span><Settings2 size={16}/></button>
      </div>
    </aside>

    <main className="main-panel">
      <header className="topbar">
        <div className="topbar-left"><button className="icon-button menu-toggle" aria-label={t("Toggle navigation", "Navigation umschalten")} onClick={toggleNavigation}>{collapsed ? <PanelLeftOpen size={19}/> : <Menu size={19}/>}</button><button className="header-model-picker" onClick={() => setModal("ai")} aria-label={t("Choose your AI model", "AI-Modell auswählen")}><span>AELVOR</span><ChevronDown size={14}/></button><ChevronRight size={13}/><span className="breadcrumb-title">{activeProject?.name || t("Personal workspace", "Persönlicher Workspace")}</span><button onClick={() => setModal("ai")} className={`workspace-badge ${chatEngine === "tools" || conversationReady ? "connected" : ""}`}><span/>{chatEngine === "tools" ? "TOOLS" : conversationReady ? activeProcessor.startsWith("GPU") ? "GPU AI" : "CPU AI" : conversationState.status === "loading" ? `${Math.round(conversationState.progress * 100)}%` : "AI SETUP"}</button></div>
        <div className="topbar-right"><button className="header-voice" aria-label={t("Open voice conversation", "Sprachgespräch öffnen")} onClick={() => setModal("voice")} disabled={busy}><AudioLines size={17}/><span>{t("Voice", "Stimme")}</span></button><button className={`studio-trigger ${studioOpen ? "active" : ""}`} onClick={() => studioOpen ? setStudioOpen(false) : openStudio()}><Layers3 size={16}/><span>Studio</span><span className="studio-trigger-count">4</span></button><div className="topbar-divider"/><button className="icon-button theme-toggle" title={theme === "dark" ? t("Switch to light theme", "Zum hellen Design wechseln") : t("Switch to dark theme", "Zum dunklen Design wechseln")} aria-label={theme === "dark" ? t("Switch to light theme", "Zum hellen Design wechseln") : t("Switch to dark theme", "Zum dunklen Design wechseln")} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={18}/> : <Moon size={18}/>}</button><div className="language-switch" aria-label={t("Interface language", "Oberflächensprache")}><button className={locale === "en" ? "selected" : ""} onClick={() => changeLocale("en")} aria-pressed={locale === "en"}>EN</button><button className={locale === "de" ? "selected" : ""} onClick={() => changeLocale("de")} aria-pressed={locale === "de"}>DE</button></div><button className="icon-button settings-top" aria-label={t("Open settings", "Einstellungen öffnen")} onClick={() => setModal("settings")}><Settings2 size={17}/></button></div>
      </header>

      <SavingWarning locale={locale} issue={Boolean(workspaceStorageIssue)} draftsIssue={Boolean(draftStorageIssue)} failed={workspaceSaveFailed || draftSaveFailed} onOpen={() => setModal("settings")} onRetry={retrySaving}/>

      <div className={`main-scroll ${isChat ? "has-chat" : ""}`} ref={scrollArea} onScroll={() => { const el = scrollArea.current; if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120); }}>
        {!isChat ? <div className="welcome">
          <StartHero locale={locale} username={username}/>
          {composer}
          {chatEngine === "chat" && !conversationReady && <button className={`ai-activation-banner ${conversationState.status === "error" ? "has-error" : ""}`} onClick={() => setModal("ai")}><span className="activation-banner-icon">{conversationState.status === "loading" ? <Loader2 size={21} className="spin"/> : <BrainCircuit size={21}/>}</span><span><strong>{conversationState.status === "loading" ? t("Your AI is loading…", "Deine AI wird geladen…") : t("Your AI. On your device.", "Deine AI. Auf deinem Gerät.")}</strong><small>{conversationState.status === "loading" ? t(`${Math.round(conversationState.progress * 100)}% · Open to view progress or cancel`, `${Math.round(conversationState.progress * 100)}% · Fortschritt anzeigen oder abbrechen`) : conversationState.status === "error" ? t("Model setup needs attention. Open to retry.", "Die Einrichtung benötigt Aufmerksamkeit. Zum Wiederholen öffnen.") : selectedChatModelInfo.downloadGB !== null ? t(`Activate general chat · Download estimate ${selectedChatModelInfo.downloadGB} GB · No API key`, `Allgemeinen Chat aktivieren · Download-Schätzung ${selectedChatModelInfo.downloadGB.toLocaleString("de")} GB · Kein API-Schlüssel`) : t("Choose a model · Device check before download · No API key", "Modell wählen · Geräteprüfung vor dem Download · Kein API-Schlüssel")}</small></span><span className="activation-banner-action">{t("Open", "Öffnen")}<ArrowRight size={14}/></span></button>}
          <PromptLibrary locale={locale} disabled={busy || readingFiles} onPlaybooks={() => setModal("playbooks")} onSelect={(question, nextMode, engine) => { setPrompt(question); setMode(nextMode); setChatEngine(engine); setModeOpen(false); textarea.current?.focus(); textarea.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }}/>
          <div className="welcome-footer"><span className="footer-privacy"><ShieldCheck size={13}/>{storageLabel}</span><button onClick={() => openStudio("tools")}><span className="status-dot live"/>{t("4 local tools, ready to explore", "4 lokale Tools zum Entdecken")}<ArrowRight size={12}/></button></div>
        </div> : <div className="conversation"><div className="conversation-heading"><button className="conversation-title-button" onClick={() => current && renameChat(current)} title={t("Rename conversation", "Gespräch umbenennen")}>{current?.sourceChatId ? <GitBranch size={14}/> : <MessageSquare size={14}/>}<span>{current?.title}</span><Pencil size={12}/></button><button className="text-button" onClick={exportChat}><ArrowDownToLine size={14}/>{t("Export", "Exportieren")}</button></div>
          <div className="messages" aria-live="polite" aria-relevant="additions">{messages.map((message, index) => <article key={message.id} id={`message-${message.id}`} className={`message ${message.role} ${focusedMessage?.id === message.id ? "message-found" : ""}`}><div className="message-avatar">{message.role === "assistant" ? <BrandMark small/> : <span>{usernameInitials(username)}</span>}</div><div className="message-main"><div className="message-label">{message.role === "assistant" ? "AELVOR" : username}{message.local && <span className="message-local">{message.kind === "conversation" ? message.model || "LOCAL AI" : "LOCAL TOOLS"}</span>}{message.demo && <span className="message-demo">{t("PREPARED DEMO", "VORBEREITETE DEMO")}</span>}{message.stopped && <span className="message-state">{t("Stopped", "Gestoppt")}</span>}{message.error && <span className="message-state">{t("Incomplete", "Unvollständig")}</span>}</div>
            {message.role === "user" ? <><div className="user-text">{message.content}</div>{!!message.attachments?.length && <div className="message-files">{message.attachments.map(file => <span key={file.id}><FileText size={13}/>{file.name}{file.truncated && ` (${t("excerpt", "Auszug")})`}</span>)}</div>}<div className="user-message-actions"><button disabled={busy || readingFiles} onClick={() => editQuestion(message)}><Pencil size={12}/>{t("Edit in a new branch", "In neuem Zweig bearbeiten")}</button></div></> : <>{message.content ? <Markdown text={message.content} locale={locale} onNotice={setNotice} pending={message.pending} onOpen={(language, code, intent) => openArtifact(language, code, intent, message.id)}/> : <div className="thinking"><span/><span/><span/><small>{message.kind === "conversation" ? generationPhase?.id === message.id ? generationPhase.phase === "review" ? t("Reviewing the local draft", "Lokaler Entwurf wird geprüft") : t("Drafting on your device", "Entwurf auf deinem Gerät") : t("Thinking on your device", "Denkt auf deinem Gerät") : t("Processing locally", "Wird lokal verarbeitet")}</small></div>}{message.content && !(busy && index === messages.length - 1) && <><KnowledgeSources sources={message.knowledge || []} locale={locale}/>{message.quality && <AnswerQuality quality={message.quality} locale={locale}/>} {message.metrics && <details className="generation-metrics"><summary>{t("Response details", "Antwortdetails")}{message.metrics.completionTokens !== undefined && ` · ${message.metrics.completionTokens} tokens`}{message.metrics.decodeTokensPerSecond !== undefined && ` · ${message.metrics.decodeTokensPerSecond.toFixed(1)} tok/s`}</summary><span>{t("Elapsed", "Dauer")}: {(message.metrics.elapsedMs / 1000).toFixed(2)} s</span>{message.metrics.firstTokenMs !== null && <span>{t("First text", "Erster Text")}: {(message.metrics.firstTokenMs / 1000).toFixed(2)} s</span>}{message.metrics.promptTokens !== undefined && <span>{t("Prompt tokens", "Prompt-Tokens")}: {message.metrics.promptTokens}</span>}{message.metrics.contextRetries > 0 && <span>{t("Context reductions", "Kontextreduktionen")}: {message.metrics.contextRetries}</span>}<small>{t("Token counts and decode speed describe the displayed generation. Careful-mode elapsed time covers both passes; its first text appears after review. Timings are measured in this browser.", "Token-Zählungen und Decode-Geschwindigkeit beschreiben die angezeigte Generierung. Die Dauer im sorgfältigen Modus umfasst beide Durchläufe; erster Text erscheint nach der Prüfung. Zeiten werden in diesem Browser gemessen.")}</small></details>}{message.contextShortened && <p className="conversation-context-note">{t("Some older messages, file text or knowledge excerpts were omitted to fit the local context.", "Einige ältere Nachrichten, Dateitexte oder Wissensauszüge wurden für den lokalen Kontext ausgelassen.")}</p>}{message.finishReason === "length" && <p className="conversation-context-note">{t("The response reached its length limit.", "Die Antwort hat ihre Längengrenze erreicht.")} <button disabled={busy || readingFiles || message.error || message.stopped || message.demo} title={t("Continue this response in a new branch", "Diese Antwort in einem neuen Zweig fortsetzen")} onClick={() => current && void send(t("Continue your previous answer.", "Setze deine vorherige Antwort fort."), false, { chatId: current.id, responseId: message.id })}>{t("Continue", "Fortsetzen")} →</button></p>}<div className="message-actions">{message.kind === "conversation" && <ResponseRefine locale={locale} disabled={busy || readingFiles || !current || Boolean(message.error || message.stopped || message.demo)} onApply={instruction => current && void send(instruction, false, { chatId: current.id, responseId: message.id, intent: "refine" })}/>}<button disabled={busy || readingFiles || !current || !questionForResponse(current, message.id)} aria-label={t("Try another answer in a new branch", "Andere Antwort in neuem Zweig versuchen")} title={t("Try another answer in a new branch", "Andere Antwort in neuem Zweig versuchen")} onClick={() => regenerate(message)}><RotateCcw size={14}/></button>{message.kind === "model" && <button aria-label={t("Open Model lab", "Model-Lab öffnen")} title={t("Open Model lab", "Model-Lab öffnen")} onClick={() => openStudio("model")}><BrainCircuit size={15}/></button>}<button aria-label={t("Copy response", "Antwort kopieren")} title={t("Copy response", "Antwort kopieren")} onClick={() => void copyResponse(message)}>{justCopied === message.id ? <Check size={14}/> : <Copy size={14}/>}</button><button className={message.saved ? "saved" : ""} aria-label={message.saved ? t("Unsave response", "Antwort nicht mehr speichern") : t("Save response", "Antwort speichern")} title={t("Save response", "Antwort speichern")} onClick={() => updateMessage(current!.id, message.id, { saved: !message.saved })}><Star size={14} fill={message.saved ? "currentColor" : "none"}/></button><button className={speakingId === message.id ? "active" : ""} aria-label={speakingId === message.id ? t("Stop reading", "Vorlesen stoppen") : t("Read response aloud", "Antwort vorlesen")} title={t("Read response aloud", "Antwort vorlesen")} onClick={() => speakingId === message.id ? stopSpeech() : speak(message.content, message.id, message.language || locale)}>{speakingId === message.id ? <VolumeX size={15}/> : <Volume2 size={15}/>}</button><button aria-label={t("Download response", "Antwort herunterladen")} title={t("Download response", "Antwort herunterladen")} onClick={() => downloadText(`${attributeMarkdown(message.content)}\n\n${COPYRIGHT_NOTICE}`, "aelvor-response.md", "text/markdown")}><Download size={14}/></button></div></>}</>}
          </div></article>)}</div></div>}
      </div>
      {isChat && <div className="chat-composer-area">{!atBottom && <button className="scroll-bottom icon-button" aria-label={t("Scroll to latest message", "Zur neuesten Nachricht")} onClick={() => { setAtBottom(true); scrollArea.current?.scrollTo({ top: scrollArea.current.scrollHeight, behavior: "smooth" }); }}><ArrowDown size={17}/></button>}{composer}</div>}
      <AppFooter locale={locale} className="workspace-footer"/>
    </main>
    {studioOpen && <button className="studio-mobile-scrim" aria-label={t("Close studio overlay", "Studio-Overlay schließen")} onClick={() => setStudioOpen(false)}/>}
    <div className={`studio-container ${studioOpen ? "open" : ""}`} inert={!studioOpen} aria-hidden={!studioOpen}><Studio tab={studioTab} onTabChange={value => { setStudioTab(value); setArtifactIntent("code"); setArtifactRequest(request => request + 1); }} onClose={() => setStudioOpen(false)} locale={locale} artifacts={studioArtifacts} selected={selectedArtifact} active={studioOpen} artifactIntent={artifactIntent} artifactRequest={artifactRequest} onSelect={id => { setSelectedArtifact(id); setArtifactIntent("code"); setArtifactRequest(value => value + 1); }} onNotice={setNotice} modelBundle={modelBundle} onModelChange={setModelBundle}/></div>

    {modal && <div className="modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget) closeModal(); }}><div className={`modal modal-${modal}`} ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><div><span className="modal-eyebrow">AELVOR WORKSPACE</span><h2 id="modal-title">{modal === "terminal" ? t("Tools on your Windows PC.", "Tools auf deinem Windows-PC.") : modal === "code-projects" ? t("From idea to source.", "Von der Idee zum Quellcode.") : modal === "knowledge" ? t("Your knowledge, on your device.", "Dein Wissen auf deinem Gerät.") : modal === "project" ? projectEditingId ? t("Edit project", "Projekt bearbeiten") : t("Create a project", "Ein Projekt erstellen") : modal === "rename" ? t("A name that fits.", "Ein passender Name.") : modal === "edit" ? t("Take a new direction.", "Eine neue Richtung.") : modal === "ai" ? t("Your model library.", "Deine Modellbibliothek.") : modal === "settings" ? t("Make it yours.", "Dein Workspace.") : modal === "search" ? t("Find a conversation", "Ein Gespräch finden") : modal === "playbooks" ? t("Start with a playbook.", "Starte mit einem Playbook.") : modal === "saved" ? t("Worth keeping.", "Wissenswertes bewahren.") : modal === "voice" ? t("Let's talk.", "Lass uns reden.") : t("Delete this conversation?", "Dieses Gespräch löschen?")}</h2></div><button className="icon-button" onClick={closeModal} aria-label={t("Close dialog", "Dialog schließen")}><X size={19}/></button></div>
      {modal === "ai" && <ConversationSetup {...aiSetupProps}/>}
      {modal === "project" && <form className="conversation-edit-form" onSubmit={event => { event.preventDefault(); commitProject(); }}><p className="modal-intro">{t("Keep related conversations together. Project names are included in search and conversation backups.", "Halte zusammengehörige Gespräche beisammen. Projektnamen werden in Suche und Gesprächssicherungen einbezogen.")}</p><label htmlFor="project-name">{t("Project name", "Projektname")}</label><input id="project-name" value={projectTitle} maxLength={48} onChange={event => { setProjectTitle(event.target.value); setProjectError(""); }} placeholder={t("e.g. Security research", "z. B. Sicherheitsrecherche")}/>{projectError && <p className="feature-form-error" role="alert">{projectError === "project_duplicate" ? t("A project with this name already exists.", "Ein Projekt mit diesem Namen ist bereits vorhanden.") : projectError === "project_limit" ? t("You can keep up to 50 projects.", "Du kannst bis zu 50 Projekte behalten.") : t("Choose a name with 1–48 characters.", "Wähle einen Namen mit 1–48 Zeichen.")}</p>}<div className="conversation-edit-buttons"><button type="button" className="secondary-button" onClick={closeModal}>{t("Cancel", "Abbrechen")}</button><button className="primary-button" disabled={!projectTitle.trim()} type="submit">{projectEditingId ? t("Save project", "Projekt speichern") : t("Create project", "Projekt erstellen")}</button></div>{projectEditingId && <div className="remove-project-note"><small>{t("Removing the project keeps its conversations in All conversations.", "Beim Entfernen des Projekts bleiben seine Gespräche unter Alle Gespräche erhalten.")}</small><button type="button" className="text-button danger-text" onClick={deleteProject}><Trash2 size={13}/>{t("Remove project", "Projekt entfernen")}</button></div>}</form>}
      {modal === "rename" && <form className="conversation-edit-form" onSubmit={event => { event.preventDefault(); const title = renameTitle.trim().replace(/\s+/g, " ").slice(0, 100); if (!title) return; setChats(previous => previous.map(chat => chat.id === renameId ? { ...chat, title } : chat)); closeModal(); }}><label htmlFor="conversation-name">{t("Conversation name", "Gesprächsname")}</label><input id="conversation-name" value={renameTitle} maxLength={100} onChange={event => setRenameTitle(event.target.value)}/><div className="conversation-edit-buttons"><button type="button" className="secondary-button" onClick={closeModal}>{t("Cancel", "Abbrechen")}</button><button className="primary-button" disabled={!renameTitle.trim()} type="submit">{t("Save name", "Namen speichern")}</button></div></form>}
      {modal === "edit" && editSource && <form className="conversation-edit-form" onSubmit={event => { event.preventDefault(); void send(editText, false, editSource); }}><div className="branch-note"><GitBranch size={18}/><p>{t("Change your question and explore another answer. Earlier messages and attached text are copied into a new conversation; the original stays available.", "Ändere deine Frage und erkunde eine andere Antwort. Frühere Nachrichten und angehängter Text werden in ein neues Gespräch kopiert; das Original bleibt verfügbar.")}</p></div><label htmlFor="edited-question">{t("Your question", "Deine Frage")}</label><textarea id="edited-question" value={editText} maxLength={chatEngine === "chat" ? 6000 : 20000} rows={7} onChange={event => setEditText(event.target.value)}/><small>{editText.length.toLocaleString(locale)} / {(chatEngine === "chat" ? 6000 : 20000).toLocaleString(locale)} · {chatEngine === "chat" ? "AI Chat" : t("Local tools", "Lokale Tools")}</small><div className="conversation-edit-buttons"><button type="button" className="secondary-button" onClick={closeModal}>{t("Cancel", "Abbrechen")}</button><button className="primary-button" disabled={busy || readingFiles || !editText.trim()} type="submit"><GitBranch size={14}/>{t("Branch & send", "Verzweigen & senden")}</button></div></form>}
      {modal === "code-projects" && <CodeProjects onTerminal={projectId => { setSelectedCodeProjectId(projectId); setModal("terminal"); }} history={projectVersions} projects={codeProjects} selectedId={selectedCodeProjectId} locale={locale} saveStatus={codeProjectsStatus} loadError={codeProjectsLoadError} incoming={pendingCodeImport} onDismissImport={() => setPendingCodeImport(null)} onChange={changeCodeProjects} onSelect={setSelectedCodeProjectId} onRetrySave={retryCodeProjectsSave} onAiRequest={prepareCodeProjectRequest}/>}
      {modal === "terminal" && <WindowsTerminal locale={locale} project={codeProjects.find(project => project.id === selectedCodeProjectId)} busy={busy} onAiRequest={prepareTerminalRequest}/>}
      {modal === "knowledge" && <KnowledgeLibrary documents={knowledgeDocuments} onChange={changeKnowledge} locale={locale} busy={busy} persisted={knowledgePersisted} loadError={knowledgeLoadError}/>}
      {modal === "settings" && <div className="settings-content"><div className="connection-card"><span className="connection-icon"><BrainCircuit size={20}/></span><div><strong>{t("AI Chat + local tools", "AI-Chat + lokale Tools")}</strong><p>{t("Activate a supported language model for natural conversation about everyday topics, technology and cybersecurity. Use Local tools for deterministic inspection and the Classifier lab for text-model training.", "Aktiviere ein unterstütztes Sprachmodell für natürliche Gespräche über Alltag, Technologie und Cybersecurity. Nutze lokale Tools für deterministische Prüfungen und das Klassifikator-Lab für Textmodell-Training.")}<button className="manage-ai-link" onClick={() => setModal("ai")}>{t("Manage conversation model", "Gesprächsmodell verwalten")} →</button></p></div><span className="status-dot live"/></div>
        <section className="profile-settings" aria-labelledby="profile-settings-title"><div className="profile-settings-heading"><span className="avatar">{usernameInitials(username)}</span><div><h3 id="profile-settings-title">{t("Your username", "Dein Benutzername")}</h3><p>{t("The name shown in your profile and conversations on this device.", "Der Name in deinem Profil und deinen Gesprächen auf diesem Gerät.")}</p></div></div><UsernameForm locale={locale} initial={username} onSave={chooseUsername} persisted={usernamePersisted}/></section>
        <div className="setting-row"><div className="setting-label"><Sun size={17}/><span><strong>{t("Appearance", "Darstellung")}</strong><small>{t("Choose your workspace theme", "Wähle dein Workspace-Design")}</small></span></div><div className="theme-options"><button className={theme === "dark" ? "selected" : ""} onClick={() => setTheme("dark")} aria-pressed={theme === "dark"}><Moon size={13}/>{t("Dark", "Dunkel")}</button><button className={theme === "light" ? "selected" : ""} onClick={() => setTheme("light")} aria-pressed={theme === "light"}><Sun size={13}/>{t("Light", "Hell")}</button></div></div>
        <div className="setting-row"><div className="setting-label"><Globe2 size={17}/><span><strong>{t("Language", "Sprache")}</strong><small>{t("Interface and fallback reply language", "Oberflächensprache und Standard-Antwortsprache")}</small></span></div><div className="language-switch large"><button className={locale === "en" ? "selected" : ""} onClick={() => changeLocale("en")}>English</button><button className={locale === "de" ? "selected" : ""} onClick={() => changeLocale("de")}>Deutsch</button></div></div>
        <div className="setting-row"><div className="setting-label"><Volume2 size={17}/><span><strong>{t("Read responses aloud", "Antworten vorlesen")}</strong><small>{t("Automatically speak new answers", "Neue Antworten automatisch vorlesen")}</small></span></div><button className={`toggle ${autoSpeak ? "on" : ""}`} role="switch" aria-checked={autoSpeak} aria-label={t("Read responses aloud automatically", "Antworten automatisch vorlesen")} onClick={() => setAutoSpeak(!autoSpeak)} disabled={!voiceAvailable}><span/></button></div>
        <div className="setting-row"><div className="setting-label"><Headphones size={17}/><span><strong>{t("Voice", "Stimme")}</strong><small>{t("Available voices depend on your browser", "Verfügbare Stimmen hängen vom Browser ab")}</small></span></div><select className="voice-select" value={voiceId} onChange={event => setVoiceId(event.target.value)} aria-label={t("Choose a voice", "Stimme auswählen")} disabled={!voiceAvailable}><option value="">{t("System default", "Systemstandard")}</option>{voices.filter(voice => voice.lang.startsWith(locale)).map(voice => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name}</option>)}</select></div>
        <div className="setting-note"><ShieldCheck size={16}/><p>{t("Conversations, training examples, and model weights are stored in this browser. AI inference runs on your device after model files are downloaded. Voice input may use your browser's speech service.", "Gespräche, Trainingsbeispiele und Modellgewichte werden in diesem Browser gespeichert. AI-Vorhersagen laufen nach dem Download der Modelldateien auf deinem Gerät. Die Spracheingabe kann den Sprachdienst deines Browsers nutzen.")}</p></div>
        <AssistantSettings value={assistantPreferences} onSave={saveAssistantSettings} locale={locale} persisted={assistantPreferencesPersisted}/>
        <button className="secondary-button" onClick={() => setModal("code-projects")}><FolderCode size={14}/>{t("Open Code projects", "Code-Projekte öffnen")}</button>
        <button className="secondary-button" onClick={() => setModal("knowledge")}><BookOpen size={14}/>{t("Manage local knowledge", "Lokales Wissen verwalten")}</button>
        <button className="secondary-button" disabled={busy || readingFiles || clearingModelCache} onClick={reviewStartupChoice}><Cpu size={14}/>{t("Review startup AI choice", "AI-Startauswahl prüfen")}</button>
        {workspaceStorageIssue && <WorkspaceRecovery issue={workspaceStorageIssue} locale={locale} busy={busy} onDownload={downloadOriginalWorkspace} onReplace={replaceSavedWorkspace}/>}
        {!workspaceStorageIssue && draftStorageIssue && <WorkspaceRecovery target="drafts" issue={draftStorageIssue} locale={locale} busy={busy} onDownload={() => downloadRecoveryData(draftStorageIssue.raw, "aelvor-drafts-recovery.txt")} onReplace={replaceSavedDrafts}/>}
        <ConversationBackupPanel chats={chats} projects={projects} locale={locale} busy={busy} onImport={importConversations} onNotice={setNotice}/>
        <div className="data-section"><strong>{t("Your data, your control.", "Deine Daten, deine Kontrolle.")}</strong>{confirmClear ? <div className="confirm-clear"><p>{t("Delete all conversations, saved responses and drafts from this device? This cannot be undone.", "Alle Gespräche, gespeicherten Antworten und Entwürfe von diesem Gerät löschen? Dies kann nicht rückgängig gemacht werden.")}</p><div><button className="secondary-button" onClick={() => setConfirmClear(false)}>{t("Cancel", "Abbrechen")}</button><button className="danger-button" onClick={clearConversationHistory}>{t("Delete all", "Alles löschen")}</button></div></div> : <button className="text-button danger-text" onClick={() => setConfirmClear(true)} disabled={busy || !chats.length}><Trash2 size={14}/>{t("Clear conversation history", "Gesprächsverlauf löschen")}</button>}</div>
      </div>}
      {modal === "search" && <><div className="search-field"><Search size={18}/><input autoFocus maxLength={240} placeholder={t("Search titles, messages and file text…", "Titel, Nachrichten und Dateitext durchsuchen…")} value={query} onChange={event => setQuery(event.target.value)}/><kbd>ESC</kbd></div>
        <div className="search-filter-bar"><div role="group" aria-label={t("Filter conversations", "Gespräche filtern")}>{(["all", "pinned", "saved"] as SearchFilter[]).map(filter => <button key={filter} className={searchFilter === filter ? "selected" : ""} aria-pressed={searchFilter === filter} onClick={() => setSearchFilter(filter)}>{filter === "pinned" ? <Pin size={12}/> : filter === "saved" ? <Star size={12}/> : <MessageSquare size={12}/>} {filter === "all" ? t("All", "Alle") : filter === "pinned" ? t("Pinned", "Angeheftet") : t("Saved answers", "Gespeicherte Antworten")}</button>)}</div><span>{searchResults.length} {t("results", "Ergebnisse")}</span></div>
        <div className="modal-results conversation-search-results">{searchResults.map(({ chat, messageId, snippet }) => <button className="result-item" key={chat.id} onClick={() => selectChat(chat.id, messageId)}>{chat.pinned ? <Pin size={17}/> : <MessageSquare size={18}/>}<span><strong>{highlightedText(chat.title, query).map((part, index) => part.match ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>)}</strong><small>{highlightedText(snippet || t("No messages yet", "Noch keine Nachrichten"), query).map((part, index) => part.match ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>)}</small><em>{chat.projectId && `${projects.find(project => project.id === chat.projectId)?.name || ""} · `}{chat.messages.length} {t("messages", "Nachrichten")}{messageId && ` · ${t("Jump to match", "Zur Fundstelle")}`}</em></span><ArrowRight size={16}/></button>)}{!searchResults.length && <div className="modal-empty"><Search size={28}/><h3>{t("No conversations found", "Keine Gespräche gefunden")}</h3><p>{t("Try different words or switch the search filter.", "Versuche andere Wörter oder ändere den Suchfilter.")}</p></div>}</div><p className="search-limit-note">{t("Up to 50 results · All search stays on this device", "Bis zu 50 Ergebnisse · Die Suche bleibt auf diesem Gerät")}</p></>}
      {modal === "playbooks" && <><p className="modal-intro">{t("A practical starting point for what comes next. Select an example, then send it to AELVOR.", "Ein praktischer Startpunkt für deinen nächsten Schritt. Wähle ein Beispiel und sende es an AELVOR.")}</p><div className="demo-note"><Sparkles size={14}/>{t("Local analysis and supported templates · No external AI required", "Lokale Analyse und unterstützte Vorlagen · Keine externe AI nötig")}</div>{templateCards}</>}
      {modal === "saved" && <div className="modal-results">{saved.length ? saved.map(({ chat, message }) => <button className="result-item" key={message.id} onClick={() => selectChat(chat.id, message.id)}><Star size={18}/><span><strong>{message.content.replace(/[#*`]/g, "").slice(0, 100)}</strong><small>{chat.title}</small></span><ArrowRight size={16}/></button>) : <div className="modal-empty"><Star size={30}/><h3>{t("Keep a good answer close.", "Gute Antworten griffbereit.")}</h3><p>{t("Use the star below any response to save it here.", "Speichere eine Antwort hier mit dem Stern darunter.")}</p></div>}</div>}
      {modal === "voice" && <div className="voice-content"><div className={`voice-orb ${listening ? "listening" : ""} ${speakingId ? "speaking" : ""}`}><div className="voice-orbit"/><div className="voice-bars">{Array.from({ length: 9 }, (_, index) => <span key={index} style={{ animationDelay: `${index * 0.12}s` }}/>)}</div></div><span className="voice-status">{listening ? t("Listening to you…", "Ich höre dir zu…") : speakingId ? t("AELVOR is speaking…", "AELVOR spricht…") : busy ? t("Preparing your response…", "Deine Antwort wird vorbereitet…") : t("A conversation, naturally.", "Einfach miteinander reden.")}</span><p>{transcript || t("Press the microphone and ask your question. AELVOR will reply in text and voice.", "Drücke auf das Mikrofon und stelle deine Frage. AELVOR antwortet mit Text und Stimme.")}</p><div className="voice-controls"><button className="voice-locale" onClick={() => { changeLocale(locale === "en" ? "de" : "en"); }}><Globe2 size={15}/>{locale === "en" ? "English" : "Deutsch"}</button><button className={`voice-mic ${listening ? "active" : ""}`} onClick={() => startListening(true)} disabled={busy} aria-label={listening ? t("Stop listening and send", "Aufnahme beenden und senden") : t("Start listening", "Aufnahme starten")}>{listening ? <Square size={22} fill="currentColor"/> : <Mic size={25}/>}</button><button className="voice-end" onClick={() => { stopListening(); stopSpeech(); }} aria-label={t("Stop audio", "Audio stoppen")}><VolumeX size={19}/></button></div><div className="voice-availability">{!micAvailable ? t("Speech recognition is unavailable in this browser. Try Chrome or Edge.", "Spracherkennung ist in diesem Browser nicht verfügbar. Nutze Chrome oder Edge.") : !voiceAvailable ? t("Speech output is unavailable in this browser.", "Sprachausgabe ist in diesem Browser nicht verfügbar.") : t("Uses your browser's microphone and available voices.", "Nutzt dein Browser-Mikrofon und verfügbare Stimmen.")}</div><span className="voice-demo-hint">{chatEngine === "chat" ? conversationReady ? t("AI Chat is ready. Ask a question in English or German.", "AI-Chat ist bereit. Stelle eine Frage auf Englisch oder Deutsch.") : t("Activate AI Chat before starting a voice conversation.", "Aktiviere AI-Chat, bevor du ein Sprachgespräch beginnst.") : t("Voice is using the local tools engine.", "Die Stimme verwendet den lokalen Tool-Motor.")}</span></div>}
      {modal === "delete" && <div className="delete-content"><p>{t("This will permanently remove the conversation and its saved responses from this device.", "Das Gespräch und seine gespeicherten Antworten werden dauerhaft von diesem Gerät entfernt.")}</p><div><button className="secondary-button" onClick={closeModal}>{t("Cancel", "Abbrechen")}</button><button className="danger-button" disabled={busy} onClick={deleteConversation}>{t("Delete conversation", "Gespräch löschen")}</button></div></div>}
    </div></div>}
    {!!notice && <div className="toast" role="status"><span>{notice}</span><button aria-label={t("Dismiss notification", "Meldung schließen")} onClick={() => setNotice("")}><X size={15}/></button></div>}
  </div>;
}
