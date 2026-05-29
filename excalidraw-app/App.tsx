import {
  Excalidraw,
  LiveCollaborationTrigger,
  TTDDialogTrigger,
  CaptureUpdateAction,
  reconcileElements,
  useEditorInterface,
  ExcalidrawAPIProvider,
  useExcalidrawAPI,
  Sidebar,
} from "@excalidraw/excalidraw";
import { trackEvent } from "@excalidraw/excalidraw/analytics";
import { getDefaultAppState } from "@excalidraw/excalidraw/appState";
import {
  CommandPalette,
  DEFAULT_CATEGORIES,
} from "@excalidraw/excalidraw/components/CommandPalette/CommandPalette";
import { ErrorDialog } from "@excalidraw/excalidraw/components/ErrorDialog";
import { OverwriteConfirmDialog } from "@excalidraw/excalidraw/components/OverwriteConfirm/OverwriteConfirm";
import { openConfirmModal } from "@excalidraw/excalidraw/components/OverwriteConfirm/OverwriteConfirmState";
import { ShareableLinkDialog } from "@excalidraw/excalidraw/components/ShareableLinkDialog";
import Trans from "@excalidraw/excalidraw/components/Trans";
import {
  APP_NAME,
  EVENT,
  THEME,
  VERSION_TIMEOUT,
  debounce,
  getVersion,
  getFrame,
  isTestEnv,
  preventUnload,
  resolvablePromise,
  isRunningInIframe,
  isDevEnv,
} from "@excalidraw/common";
import polyfill from "@excalidraw/excalidraw/polyfill";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadFromBlob } from "@excalidraw/excalidraw/data/blob";
import { t } from "@excalidraw/excalidraw/i18n";
import { Volume2, Code2, Code, Play, Check, X as LucideX, BookOpen, Sparkles, PlusCircle, Palette, ChevronRight, LogOut } from "lucide-react";
import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { MonacoBinding } from "y-monaco";
import Editor from "@monaco-editor/react";

import {
  GithubIcon,
  XBrandIcon,
  DiscordIcon,
  ExcalLogo,
  usersIcon,
  exportToPlus,
  share,
  youtubeIcon,
} from "@excalidraw/excalidraw/components/icons";
import { isElementLink } from "@excalidraw/element";
import {
  bumpElementVersions,
  restoreAppState,
  restoreElements,
} from "@excalidraw/excalidraw/data/restore";
import { newElementWith } from "@excalidraw/element";
import { isInitializedImageElement } from "@excalidraw/element";
import clsx from "clsx";
import {
  parseLibraryTokensFromUrl,
  useHandleLibrary,
} from "@excalidraw/excalidraw/data/library";

import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { RestoredDataState } from "@excalidraw/excalidraw/data/restore";
import type {
  FileId,
  NonDeletedExcalidrawElement,
  OrderedExcalidrawElement,
} from "@excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
  BinaryFiles,
  ExcalidrawInitialDataState,
  UIAppState,
  ExcalidrawProps,
} from "@excalidraw/excalidraw/types";
import type { ResolutionType } from "@excalidraw/common/utility-types";
import type { ResolvablePromise } from "@excalidraw/common/utils";

import CustomStats from "./CustomStats";
import {
  Provider,
  useAtom,
  useAtomValue,
  useAtomWithInitialValue,
  appJotaiStore,
} from "./app-jotai";
import {
  FIREBASE_STORAGE_PREFIXES,
  isExcalidrawPlusSignedUser,
  STORAGE_KEYS,
  SYNC_BROWSER_TABS_TIMEOUT,
} from "./app_constants";
import Collab, {
  collabAPIAtom,
  isCollaboratingAtom,
  isOfflineAtom,
} from "./collab/Collab";
import { AppFooter } from "./components/AppFooter";
import { AppMainMenu } from "./components/AppMainMenu";
import { AppWelcomeScreen } from "./components/AppWelcomeScreen";
import {
  ExportToExcalidrawPlus,
  exportToExcalidrawPlus,
} from "./components/ExportToExcalidrawPlus";
import { TopErrorBoundary } from "./components/TopErrorBoundary";

import {
  exportToBackend,
  getCollaborationLinkData,
  importFromBackend,
  isCollaborationLink,
} from "./data";

import { updateStaleImageStatuses } from "./data/FileManager";
import { FileStatusStore } from "./data/fileStatusStore";
import {
  importFromLocalStorage,
  importUsernameFromLocalStorage,
} from "./data/localStorage";

import { loadFilesFromFirebase } from "./data/firebase";
import {
  LibraryIndexedDBAdapter,
  LibraryLocalStorageMigrationAdapter,
  LocalData,
  localStorageQuotaExceededAtom,
} from "./data/LocalData";
import { isBrowserStorageStateNewer } from "./data/tabSync";
import { ShareDialog, shareDialogStateAtom } from "./share/ShareDialog";
import CollabError, { collabErrorIndicatorAtom } from "./collab/CollabError";
import { useHandleAppTheme } from "./useHandleAppTheme";
import { getPreferredLanguage } from "./app-language/language-detector";
import { useAppLangCode } from "./app-language/language-state";
import DebugCanvas, {
  debugRenderer,
  isVisualDebuggerEnabled,
  loadSavedDebugState,
} from "./components/DebugCanvas";
import { AIComponents } from "./components/AI";
import { ExcalidrawPlusIframeExport } from "./ExcalidrawPlusIframeExport";

import "./index.scss";

import { ExcalidrawPlusPromoBanner } from "./components/ExcalidrawPlusPromoBanner";
import { AppSidebar } from "./components/AppSidebar";

import type { CollabAPI } from "./collab/Collab";

polyfill();

window.EXCALIDRAW_THROTTLE_RENDER = true;

declare global {
  interface BeforeInstallPromptEventChoiceResult {
    outcome: "accepted" | "dismissed";
  }

  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<BeforeInstallPromptEventChoiceResult>;
  }

  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

let pwaEvent: BeforeInstallPromptEvent | null = null;

// Adding a listener outside of the component as it may (?) need to be
// subscribed early to catch the event.
//
// Also note that it will fire only if certain heuristics are met (user has
// used the app for some time, etc.)
window.addEventListener(
  "beforeinstallprompt",
  (event: BeforeInstallPromptEvent) => {
    // prevent Chrome <= 67 from automatically showing the prompt
    event.preventDefault();
    // cache for later use
    pwaEvent = event;
  },
);

let isSelfEmbedding = false;

if (window.self !== window.top) {
  try {
    const parentUrl = new URL(document.referrer);
    const currentUrl = new URL(window.location.href);
    if (parentUrl.origin === currentUrl.origin) {
      isSelfEmbedding = true;
    }
  } catch (error) {
    // ignore
  }
}

const shareableLinkConfirmDialog = {
  title: t("overwriteConfirm.modal.shareableLink.title"),
  description: (
    <Trans
      i18nKey="overwriteConfirm.modal.shareableLink.description"
      bold={(text) => <strong>{text}</strong>}
      br={() => <br />}
    />
  ),
  actionLabel: t("overwriteConfirm.modal.shareableLink.button"),
  color: "danger",
} as const;

const initializeScene = async (opts: {
  collabAPI: CollabAPI | null;
  excalidrawAPI: ExcalidrawImperativeAPI;
}): Promise<
  { scene: ExcalidrawInitialDataState | null } & (
    | { isExternalScene: true; id: string; key: string }
    | { isExternalScene: false; id?: null; key?: null }
  )
> => {
  const searchParams = new URLSearchParams(window.location.search);
  const id = searchParams.get("id");
  const jsonBackendMatch = window.location.hash.match(
    /^#json=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)$/,
  );
  const externalUrlMatch = window.location.hash.match(/^#url=(.*)$/);

  const localDataState = importFromLocalStorage();

  let scene: Omit<
    RestoredDataState,
    // we're not storing files in the scene database/localStorage, and instead
    // fetch them async from a different store
    "files"
  > & {
    scrollToContent?: boolean;
  } = {
    elements: restoreElements(localDataState?.elements, null, {
      repairBindings: true,
      deleteInvisibleElements: true,
    }),
    appState: restoreAppState(localDataState?.appState, null),
  };

  let roomLinkData = getCollaborationLinkData(window.location.href);
  const isExternalScene = !!(id || jsonBackendMatch || roomLinkData);
  if (isExternalScene) {
    if (
      // don't prompt if scene is empty
      !scene.elements.length ||
      // don't prompt for collab scenes because we don't override local storage
      roomLinkData ||
      // otherwise, prompt whether user wants to override current scene
      (await openConfirmModal(shareableLinkConfirmDialog))
    ) {
      if (jsonBackendMatch) {
        const imported = await importFromBackend(
          jsonBackendMatch[1],
          jsonBackendMatch[2],
        );

        scene = {
          elements: bumpElementVersions(
            restoreElements(imported.elements, null, {
              repairBindings: true,
              deleteInvisibleElements: true,
            }),
            localDataState?.elements,
          ),
          appState: restoreAppState(
            imported.appState,
            // local appState when importing from backend to ensure we restore
            // localStorage user settings which we do not persist on server.
            localDataState?.appState,
          ),
        };
      }
      scene.scrollToContent = true;
      if (!roomLinkData) {
        window.history.replaceState({}, APP_NAME, window.location.origin);
      }
    } else {
      // https://github.com/excalidraw/excalidraw/issues/1919
      if (document.hidden) {
        return new Promise((resolve, reject) => {
          window.addEventListener(
            "focus",
            () => initializeScene(opts).then(resolve).catch(reject),
            {
              once: true,
            },
          );
        });
      }

      roomLinkData = null;
      window.history.replaceState({}, APP_NAME, window.location.origin);
    }
  } else if (externalUrlMatch) {
    window.history.replaceState({}, APP_NAME, window.location.origin);

    const url = externalUrlMatch[1];
    try {
      const request = await fetch(window.decodeURIComponent(url));
      const data = await loadFromBlob(await request.blob(), null, null);
      if (
        !scene.elements.length ||
        (await openConfirmModal(shareableLinkConfirmDialog))
      ) {
        return { scene: data, isExternalScene };
      }
    } catch (error: any) {
      return {
        scene: {
          appState: {
            errorMessage: t("alerts.invalidSceneUrl"),
          },
        },
        isExternalScene,
      };
    }
  }

  if (roomLinkData && opts.collabAPI) {
    const { excalidrawAPI } = opts;

    const scene = await opts.collabAPI.startCollaboration(roomLinkData);

    return {
      // when collaborating, the state may have already been updated at this
      // point (we may have received updates from other clients), so reconcile
      // elements and appState with existing state
      scene: {
        ...scene,
        appState: {
          ...restoreAppState(
            {
              ...scene?.appState,
              theme: localDataState?.appState?.theme || scene?.appState?.theme,
            },
            excalidrawAPI.getAppState(),
          ),
          // necessary if we're invoking from a hashchange handler which doesn't
          // go through App.initializeScene() that resets this flag
          isLoading: false,
        },
        elements: reconcileElements(
          scene?.elements || [],
          excalidrawAPI.getSceneElementsIncludingDeleted() as RemoteExcalidrawElement[],
          excalidrawAPI.getAppState(),
        ),
      },
      isExternalScene: true,
      id: roomLinkData.roomId,
      key: roomLinkData.roomKey,
    };
  } else if (scene) {
    return isExternalScene && jsonBackendMatch
      ? {
          scene,
          isExternalScene,
          id: jsonBackendMatch[1],
          key: jsonBackendMatch[2],
        }
      : { scene, isExternalScene: false };
  }
  return { scene: null, isExternalScene: false };
};

// Global session registry to avoid duplicated provider registrations under React StrictMode double rendering
const globalCollaborationCache: Record<string, { doc: Y.Doc; provider: any; count: number }> = {};

const getCollaborationSession = (roomId: string) => {
  if (typeof window === "undefined") return { doc: null, provider: null };
  
  if (globalCollaborationCache[roomId]) {
    globalCollaborationCache[roomId].count++;
    return globalCollaborationCache[roomId];
  }
  
  const doc = new Y.Doc();
  const provider = new WebrtcProvider(roomId, doc);
  
  const nickname = localStorage.getItem("codegraph_username") || "User";
  const avatarColor = localStorage.getItem("codegraph_avatar_color") || "#6366f1";
  
  provider.awareness.setLocalStateField('user', {
    name: nickname,
    color: avatarColor
  });

  globalCollaborationCache[roomId] = { doc, provider, count: 1 };
  return globalCollaborationCache[roomId];
};

const releaseCollaborationSession = (roomId: string) => {
  if (globalCollaborationCache[roomId]) {
    globalCollaborationCache[roomId].count--;
    if (globalCollaborationCache[roomId].count <= 0) {
      globalCollaborationCache[roomId].provider.destroy();
      globalCollaborationCache[roomId].doc.destroy();
      delete globalCollaborationCache[roomId];
    }
  }
};

interface Problem {
  id: string;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  description: string;
  explanationText: string;
  codeTemplate: string;
  testCases: Array<{ input: string; expectedOutput: string }>;
}

const DEFAULT_PROBLEMS: Problem[] = [
  {
    id: "two-sum",
    title: "Two Sum",
    difficulty: "Easy",
    description: "Given an array of integers `nums` and an integer `target`, return indices of the two numbers such that they add up to `target`.\n\nYou may assume that each input would have exactly one solution, and you may not use the same element twice.",
    explanationText: "To solve Two Sum, we want to find two numbers that sum up to our target. We can iterate through the array, keeping track of the difference between the target and each number in a hash map. If the difference already exists in our map, we have found our pair!",
    codeTemplate: `// Native Excalidraw Code Console Playground
// Two Sum algorithm workspace.

function solve(nums, target) {
  const map = new Map();
  for (let i = 0; i < nums.length; i++) {
    const diff = target - nums[i];
    if (map.has(diff)) {
      console.log("Found matching indexes:", map.get(diff), "and", i);
      return [map.get(diff), i];
    }
    map.set(nums[i], i);
  }
  return [];
}`,
    testCases: [
      { input: '{"nums": [2,7,11,15], "target": 9}', expectedOutput: "[0,1]" },
      { input: '{"nums": [3,2,4], "target": 6}', expectedOutput: "[1,2]" },
      { input: '{"nums": [3,3], "target": 6}', expectedOutput: "[0,1]" }
    ]
  },
  {
    id: "valid-parentheses",
    title: "Valid Parentheses",
    difficulty: "Easy",
    description: "Given a string `s` containing just the characters `(`, `)`, `{`, `}`, `[` and `]`, determine if the input string is valid.\n\nAn input string is valid if open brackets are closed by the same type of brackets and closed in the correct order.",
    explanationText: "Valid Parentheses is best solved with a stack data structure. As we scan the string from left to right, we push open brackets onto the stack. When we encounter a closing bracket, we check if the top of the stack matches the closing bracket. If it matches, we pop it off!",
    codeTemplate: `// Native Excalidraw Code Console Playground
// Valid Parentheses workspace.

function solve(s) {
  const stack = [];
  const matches = {
    ')': '(',
    '}': '{',
    ']': '['
  };
  for (let char of s) {
    if (char in matches) {
      if (stack.length === 0 || stack[stack.length - 1] !== matches[char]) {
        console.log("Invalid bracket mismatch found:", char);
        return false;
      }
      stack.pop();
    } else {
      stack.push(char);
    }
  }
  const isValid = stack.length === 0;
  console.log("Sequence check outcome:", isValid);
  return isValid;
}`,
    testCases: [
      { input: '"()"', expectedOutput: "true" },
      { input: '"()[]{}"', expectedOutput: "true" },
      { input: '"(]"', expectedOutput: "false" }
    ]
  },
  {
    id: "reverse-integer",
    title: "Reverse Integer",
    difficulty: "Medium",
    description: "Given a signed 32-bit integer `x`, return `x` with its digits reversed. If reversing `x` causes the value to go outside the signed 32-bit integer range `[-2^31, 2^31 - 1]`, then return `0`.",
    explanationText: "Reversing an integer requires stripping digits one by one using modulo arithmetic. We multiply our running result by 10 and add the remainder of x divided by 10. To prevent overflow in standard 32-bit registers, we must return 0 if our reversed number exceeds 2147483647 or falls below -2147483648.",
    codeTemplate: `// Native Excalidraw Code Console Playground
// Reverse Integer workspace.

function solve(x) {
  const isNegative = x < 0;
  let reversed = 0;
  let num = Math.abs(x);
  while (num > 0) {
    const digit = num % 10;
    reversed = (reversed * 10) + digit;
    num = Math.floor(num / 10);
  }
  if (reversed > 2147483647) {
    console.log("32-bit overflow boundary reached for:", x);
    return 0;
  }
  const outcome = isNegative ? -reversed : reversed;
  console.log("Reversed integer result:", outcome);
  return outcome;
}`,
    testCases: [
      { input: "123", expectedOutput: "321" },
      { input: "-123", expectedOutput: "-321" },
      { input: "120", expectedOutput: "21" }
    ]
  }
];

const ExcalidrawWrapper = () => {
  const excalidrawAPI = useExcalidrawAPI();

  const [errorMessage, setErrorMessage] = useState("");
  const isCollabDisabled = isRunningInIframe();

  const { editorTheme, appTheme, setAppTheme } = useHandleAppTheme();

  // custom programming sandbox runner states
  const [code, setCode] = useState(`function solve(input) {\n  // Your code here\n  return input;\n}`);
  const [testResults, setTestResults] = useState<any[]>([]);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [collaborators, setCollaborators] = useState(1);
  const [lastExecutionState, setLastExecutionState] = useState<"idle" | "success" | "error">("idle");
  const [activeTestCaseIdx, setActiveTestCaseIdx] = useState(0);
  const [activeResultTab, setActiveResultTab] = useState<"interactive" | "results" | "parameters">("interactive");
  const [activeEditorTab, setActiveEditorTab] = useState<"code" | "instructions">("code");

  // serverless problems database state
  const [problems, setProblems] = useState<any[]>([]);
  const [activeProblem, setActiveProblem] = useState<any>(null);

  // creator form states
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newDiff, setNewDiff] = useState<"Easy" | "Medium" | "Hard">("Easy");
  const [newSpeech, setNewSpeech] = useState("");
  const [creatorMsg, setCreatorMsg] = useState("");
  const [newCases, setNewCases] = useState<Array<{ input: string; expectedOutput: string }>>([
    { input: '{"nums": [1,2], "target": 3}', expectedOutput: "[0,1]" }
  ]);

  // theme selector states
  const [activeTheme, setActiveTheme] = useState("cyberpunk");

  // left retractable whiteboard drawer states
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<"library" | "creator" | "themes">("library");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("codegraph_problems");
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          setProblems(parsed);
          if (parsed.length > 0) setActiveProblem(parsed[0]);
        } catch (e) {
          setProblems(DEFAULT_PROBLEMS);
          setActiveProblem(DEFAULT_PROBLEMS[0]);
        }
      } else {
        localStorage.setItem("codegraph_problems", JSON.stringify(DEFAULT_PROBLEMS));
        setProblems(DEFAULT_PROBLEMS);
        setActiveProblem(DEFAULT_PROBLEMS[0]);
      }

      const storedTheme = localStorage.getItem("codegraph_theme") || "cyberpunk";
      setActiveTheme(storedTheme);
      document.body.setAttribute("data-theme", storedTheme);
      if (storedTheme === "light") {
        setAppTheme(THEME.LIGHT);
      } else {
        setAppTheme(THEME.DARK);
      }
    }
  }, [setAppTheme]);

  const handleSelectTheme = (themeName: string) => {
    setActiveTheme(themeName);
    document.body.setAttribute("data-theme", themeName);
    localStorage.setItem("codegraph_theme", themeName);
    if (themeName === "light") {
      setAppTheme(THEME.LIGHT);
    } else {
      setAppTheme(THEME.DARK);
    }
  };

  const handleSelectProblem = (prob: any) => {
    setActiveProblem(prob);
    setActiveTestCaseIdx(0);
    setTestResults([]);
    setLastExecutionState("idle");

    const { doc } = collaboration;
    if (doc) {
      const ytext = doc.getText('monaco');
      ytext.delete(0, ytext.length);
      ytext.insert(0, prob.codeTemplate || `function solve(input) {\n  return input;\n}`);
    }
  };

  const handleCreateProblem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newDesc.trim()) {
      setCreatorMsg("Error: Title and Description are required!");
      return;
    }

    const createdProb = {
      id: `custom-${Date.now()}`,
      title: newTitle,
      difficulty: newDiff,
      description: newDesc,
      explanationText: newSpeech || `Solution for ${newTitle}`,
      codeTemplate: `function solve(input) {\n  // Write your custom solution here\n  return input;\n}`,
      testCases: newCases
    };

    const updated = [...problems, createdProb];
    setProblems(updated);
    localStorage.setItem("codegraph_problems", JSON.stringify(updated));
    setCreatorMsg(`Success: Problem "${newTitle}" created!`);

    setNewTitle("");
    setNewDesc("");
    setNewSpeech("");
    setNewCases([{ input: "", expectedOutput: "" }]);

    setTimeout(() => {
      setCreatorMsg("");
      setIsDrawerOpen(false);
      handleSelectProblem(createdProb);
    }, 1200);
  };

  const handleToggleTab = (tab: "library" | "creator" | "themes") => {
    if (isDrawerOpen && drawerTab === tab) {
      setIsDrawerOpen(false);
    } else {
      setDrawerTab(tab);
      setIsDrawerOpen(true);
    }
  };

  const roomId = typeof window !== "undefined" ? (() => {
    const roomParam = window.location.hash.match(/^#room=([a-zA-Z0-9_-]+),/);
    return `codegraph-sandbox-${roomParam ? roomParam[1] : "default"}`;
  })() : `codegraph-sandbox-default`;

  const [collaboration] = useState(() => {
    return getCollaborationSession(roomId);
  });

  const editorRef = useRef<any>(null);
  const bindingRef = useRef<any>(null);

  useEffect(() => {
    const { provider } = collaboration;
    if (!provider) return;

    const handleAwarenessChange = () => {
      setCollaborators(provider.awareness.getStates().size);
    };

    provider.awareness.on('change', handleAwarenessChange);
    setCollaborators(provider.awareness.getStates().size);

    return () => {
      provider.awareness.off('change', handleAwarenessChange);
      releaseCollaborationSession(roomId);
    };
  }, [collaboration, roomId]);

  useEffect(() => {
    return () => {
      if (bindingRef.current) {
        bindingRef.current.destroy();
        bindingRef.current = null;
      }
    };
  }, [activeEditorTab]);

  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor;
    
    const { doc, provider } = collaboration;
    if (!doc || !provider) return;

    if (bindingRef.current) {
      bindingRef.current.destroy();
    }

    const ytext = doc.getText('monaco');
    bindingRef.current = new MonacoBinding(
      ytext,
      editor.getModel(),
      new Set([editor]),
      provider.awareness
    );

    const initializeTemplate = () => {
      if (ytext.toString().trim() === '') {
        const startTemplate = activeProblem 
          ? activeProblem.codeTemplate 
          : `// Native Excalidraw Code Console Playground\n// Collaborative workspace active.\n\nfunction solve(input) {\n  // Write your code here\n  console.log("Hello from Excalidraw Fork!");\n  return input;\n}`;
        ytext.insert(0, startTemplate);
      }
    };
    
    if ((provider as any).synced) {
      initializeTemplate();
    } else {
      (provider as any).once('synced', initializeTemplate);
    }
  };

  const evaluateTestCase = (codeToRun: string, tc: any): Promise<any> => {
    return new Promise((resolve) => {
      const workerCode = `
        self.onmessage = function(e) {
          const { code, input } = e.data;
          const logs = [];
          
          // Intercept console.log
          const originalLog = console.log;
          console.log = function(...args) {
            logs.push(args.map(arg => {
              if (typeof arg === 'object') {
                try {
                  return JSON.stringify(arg);
                } catch (err) {
                  return String(arg);
                }
              }
              return String(arg);
            }).join(' '));
            originalLog.apply(console, args);
          };

          try {
            // Helpers to parse function parameters
            const STRIP_COMMENTS = /(\\/\\/.*$)|(\\/\\*[\\s\\S]*?\\*\\/)|(\\s*=[^,)]*(?=(?:[^{}]*\\{[^{}]*\\})*[^{}]*(?:,|\\))))/mg;
            const ARGUMENT_NAMES = /([^\\s,]+)/g;
            function getParamNames(fn) {
              const fnStr = fn.toString().replace(STRIP_COMMENTS, '');
              let result = fnStr.slice(fnStr.indexOf('(') + 1, fnStr.indexOf(')')).match(ARGUMENT_NAMES);
              if (result === null) {
                const firstArrow = fnStr.indexOf('=>');
                if (firstArrow !== -1) {
                  const beforeArrow = fnStr.slice(0, firstArrow).trim();
                  if (beforeArrow && !beforeArrow.includes('(')) {
                    return [beforeArrow];
                  }
                }
                return [];
              }
              return result.map(p => p.trim());
            }

            const fn = new Function('input', code + "\\nreturn solve;");
            const solveFn = fn();
            if (typeof solveFn !== 'function') {
              throw new Error("Could not find 'solve' function. Make sure 'function solve(input)' is declared.");
            }
            
            const parsedInput = JSON.parse(input);
            let args = [parsedInput];
            if (typeof parsedInput === 'object' && parsedInput !== null && !Array.isArray(parsedInput)) {
              const params = getParamNames(solveFn);
              const allParamsAreKeys = params.length > 0 && params.every(p => p in parsedInput);
              if (allParamsAreKeys) {
                args = params.map(p => parsedInput[p]);
              }
            }

            const result = solveFn.apply(null, args);
            self.postMessage({ success: true, result: result, logs: logs });
          } catch (err) {
            self.postMessage({ success: false, error: err.message, logs: logs });
          }
        };
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const worker = new Worker(URL.createObjectURL(blob));

      // Limit execution to 1.5 seconds maximum to catch infinite loops
      const timeoutId = setTimeout(() => {
        worker.terminate();
        resolve({
          passed: false,
          input: tc.input,
          expected: tc.expectedOutput,
          actual: "Timeout Error: Infinite loop or heavy computation detected! Execution halted safely.",
          logs: ["SYSTEM WARNING: Halted worker due to 1.5 second execution timeout limit."]
        });
      }, 1500);

      worker.onmessage = (e) => {
        clearTimeout(timeoutId);
        worker.terminate();
        const { success, result, error, logs } = e.data;

        if (!success) {
          resolve({
            passed: false,
            input: tc.input,
            expected: tc.expectedOutput,
            actual: error,
            logs: logs || []
          });
          return;
        }

        let expectedParsed = tc.expectedOutput;
        try {
          expectedParsed = JSON.parse(tc.expectedOutput);
        } catch {}

        let passed = false;
        if (typeof result === 'object' && result !== null) {
          passed = JSON.stringify(result) === JSON.stringify(expectedParsed);
        } else {
          passed = String(result) === String(expectedParsed);
        }

        const actualStr = typeof result === 'object' && result !== null ? JSON.stringify(result) : String(result);

        resolve({
          passed,
          input: tc.input,
          expected: tc.expectedOutput,
          actual: actualStr,
          logs: logs || []
        });
      };

      worker.postMessage({ code: codeToRun, input: tc.input });
    });
  };

  const sandboxTestCases = activeProblem ? activeProblem.testCases : [
    { input: '{"nums": [2,7,11,15], "target": 9}', expectedOutput: "[0,1]" },
    { input: '{"nums": [3,2,4], "target": 6}', expectedOutput: "[1,2]" },
    { input: '{"nums": [3,3], "target": 6}', expectedOutput: "[0,1]" }
  ];

  const runTests = async () => {
    const currentCode = editorRef.current ? editorRef.current.getValue() : code;
    
    const results = await Promise.all(
      sandboxTestCases.map((tc: any) => evaluateTestCase(currentCode, tc))
    );

    const hasFailure = results.some(r => !r.passed);

    setTestResults(results);
    setLastExecutionState(hasFailure ? "error" : "success");
    setActiveResultTab("interactive");
  };

  const playAudio = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      if (isPlayingAudio) {
        window.speechSynthesis.cancel();
        setIsPlayingAudio(false);
        return;
      }
      const text = activeProblem 
        ? activeProblem.explanationText 
        : "Excalidraw Whiteboard-centric Collaborative Playground active. Declare your algorithm solution inside the Monaco code console on the right and run it against execution workers in real time.";
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onend = () => setIsPlayingAudio(false);
      setIsPlayingAudio(true);
      window.speechSynthesis.speak(utterance);
    }
  };

  const [langCode, setLangCode] = useAppLangCode();

  const editorInterface = useEditorInterface();

  // initial state
  // ---------------------------------------------------------------------------

  const initialStatePromiseRef = useRef<{
    promise: ResolvablePromise<ExcalidrawInitialDataState | null>;
  }>({ promise: null! });
  if (!initialStatePromiseRef.current.promise) {
    initialStatePromiseRef.current.promise =
      resolvablePromise<ExcalidrawInitialDataState | null>();
  }

  const debugCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    trackEvent("load", "frame", getFrame());
    // Delayed so that the app has a time to load the latest SW
    setTimeout(() => {
      trackEvent("load", "version", getVersion());
    }, VERSION_TIMEOUT);
  }, []);

  const [, setShareDialogState] = useAtom(shareDialogStateAtom);
  const [collabAPI] = useAtom(collabAPIAtom);
  const [isCollaborating] = useAtomWithInitialValue(isCollaboratingAtom, () => {
    return isCollaborationLink(window.location.href);
  });
  const collabError = useAtomValue(collabErrorIndicatorAtom);

  useHandleLibrary({
    excalidrawAPI,
    adapter: LibraryIndexedDBAdapter,
    // TODO maybe remove this in several months (shipped: 24-03-11)
    migrationAdapter: LibraryLocalStorageMigrationAdapter,
  });

  const [, forceRefresh] = useState(false);

  useEffect(() => {
    if (isDevEnv()) {
      const debugState = loadSavedDebugState();

      if (debugState.enabled && !window.visualDebug) {
        window.visualDebug = {
          data: [],
        };
      } else {
        delete window.visualDebug;
      }
      forceRefresh((prev) => !prev);
    }
  }, [excalidrawAPI]);

  // ---------------------------------------------------------------------------
  // Hoisted loadImages
  // ---------------------------------------------------------------------------
  const loadImages = useCallback(
    (data: ResolutionType<typeof initializeScene>, isInitialLoad = false) => {
      if (!data.scene || !excalidrawAPI) {
        return;
      }

      if (collabAPI?.isCollaborating()) {
        if (data.scene.elements) {
          collabAPI
            .fetchImageFilesFromFirebase({
              elements: data.scene.elements,
              forceFetchFiles: true,
            })
            .then(({ loadedFiles, erroredFiles }) => {
              excalidrawAPI.addFiles(loadedFiles);
              updateStaleImageStatuses({
                excalidrawAPI,
                erroredFiles,
                elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
              });
            });
        }
      } else {
        const fileIds =
          data.scene.elements?.reduce((acc, element) => {
            if (isInitializedImageElement(element)) {
              return acc.concat(element.fileId);
            }
            return acc;
          }, [] as FileId[]) || [];

        if (data.isExternalScene) {
          if (fileIds.length) {
            // Direct Firebase call (not through FileManager), so track manually
            FileStatusStore.updateStatuses(
              fileIds.map((id) => [id, "loading"]),
            );
          }
          loadFilesFromFirebase(
            `${FIREBASE_STORAGE_PREFIXES.shareLinkFiles}/${data.id}`,
            data.key,
            fileIds,
          ).then(({ loadedFiles, erroredFiles }) => {
            excalidrawAPI.addFiles(loadedFiles);
            updateStaleImageStatuses({
              excalidrawAPI,
              erroredFiles,
              elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
            });
            FileStatusStore.updateStatuses([
              ...loadedFiles.map((f) => [f.id, "loaded"] as [FileId, "loaded"]),
              ...[...erroredFiles.keys()].map(
                (id) => [id, "error"] as [FileId, "error"],
              ),
            ]);
          });
        } else if (isInitialLoad) {
          if (fileIds.length) {
            LocalData.fileStorage
              .getFiles(fileIds)
              .then(async ({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
          // on fresh load, clear unused files from IDB (from previous
          // session)
          LocalData.fileStorage.clearObsoleteFiles({
            currentFileIds: fileIds,
          });
        }
      }
    },
    [collabAPI, excalidrawAPI],
  );

  useEffect(() => {
    if (!excalidrawAPI || (!isCollabDisabled && !collabAPI)) {
      return;
    }

    initializeScene({ collabAPI, excalidrawAPI }).then(async (data) => {
      loadImages(data, /* isInitialLoad */ true);
      initialStatePromiseRef.current.promise.resolve(data.scene);
    });

    const onHashChange = async (event: HashChangeEvent) => {
      event.preventDefault();
      const libraryUrlTokens = parseLibraryTokensFromUrl();
      if (!libraryUrlTokens) {
        if (
          collabAPI?.isCollaborating() &&
          !isCollaborationLink(window.location.href)
        ) {
          collabAPI.stopCollaboration(false);
        }
        excalidrawAPI.updateScene({ appState: { isLoading: true } });

        initializeScene({ collabAPI, excalidrawAPI }).then((data) => {
          loadImages(data);
          if (data.scene) {
            excalidrawAPI.updateScene({
              elements: restoreElements(data.scene.elements, null, {
                repairBindings: true,
              }),
              appState: restoreAppState(data.scene.appState, null),
              captureUpdate: CaptureUpdateAction.IMMEDIATELY,
            });
          }
        });
      }
    };

    const syncData = debounce(() => {
      if (isTestEnv()) {
        return;
      }
      if (
        !document.hidden &&
        ((collabAPI && !collabAPI.isCollaborating()) || isCollabDisabled)
      ) {
        // don't sync if local state is newer or identical to browser state
        if (isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_DATA_STATE)) {
          const localDataState = importFromLocalStorage();
          const username = importUsernameFromLocalStorage();
          setLangCode(getPreferredLanguage());
          excalidrawAPI.updateScene({
            ...localDataState,
            captureUpdate: CaptureUpdateAction.NEVER,
          });
          LibraryIndexedDBAdapter.load().then((data) => {
            if (data) {
              excalidrawAPI.updateLibrary({
                libraryItems: data.libraryItems,
              });
            }
          });
          collabAPI?.setUsername(username || "");
        }

        if (isBrowserStorageStateNewer(STORAGE_KEYS.VERSION_FILES)) {
          const elements = excalidrawAPI.getSceneElementsIncludingDeleted();
          const currFiles = excalidrawAPI.getFiles();
          const fileIds =
            elements?.reduce((acc, element) => {
              if (
                isInitializedImageElement(element) &&
                // only load and update images that aren't already loaded
                !currFiles[element.fileId]
              ) {
                return acc.concat(element.fileId);
              }
              return acc;
            }, [] as FileId[]) || [];
          if (fileIds.length) {
            LocalData.fileStorage
              .getFiles(fileIds)
              .then(({ loadedFiles, erroredFiles }) => {
                if (loadedFiles.length) {
                  excalidrawAPI.addFiles(loadedFiles);
                }
                updateStaleImageStatuses({
                  excalidrawAPI,
                  erroredFiles,
                  elements: excalidrawAPI.getSceneElementsIncludingDeleted(),
                });
              });
          }
        }
      }
    }, SYNC_BROWSER_TABS_TIMEOUT);

    const onUnload = () => {
      LocalData.flushSave();
    };

    const visibilityChange = (event: FocusEvent | Event) => {
      if (event.type === EVENT.BLUR || document.hidden) {
        LocalData.flushSave();
      }
      if (
        event.type === EVENT.VISIBILITY_CHANGE ||
        event.type === EVENT.FOCUS
      ) {
        syncData();
      }
    };

    window.addEventListener(EVENT.HASHCHANGE, onHashChange, false);
    window.addEventListener(EVENT.UNLOAD, onUnload, false);
    window.addEventListener(EVENT.BLUR, visibilityChange, false);
    document.addEventListener(EVENT.VISIBILITY_CHANGE, visibilityChange, false);
    window.addEventListener(EVENT.FOCUS, visibilityChange, false);
    return () => {
      window.removeEventListener(EVENT.HASHCHANGE, onHashChange, false);
      window.removeEventListener(EVENT.UNLOAD, onUnload, false);
      window.removeEventListener(EVENT.BLUR, visibilityChange, false);
      window.removeEventListener(EVENT.FOCUS, visibilityChange, false);
      document.removeEventListener(
        EVENT.VISIBILITY_CHANGE,
        visibilityChange,
        false,
      );
    };
  }, [isCollabDisabled, collabAPI, excalidrawAPI, setLangCode, loadImages]);

  useEffect(() => {
    const unloadHandler = (event: BeforeUnloadEvent) => {
      LocalData.flushSave();

      if (
        excalidrawAPI &&
        LocalData.fileStorage.shouldPreventUnload(
          excalidrawAPI.getSceneElements(),
        )
      ) {
        if (import.meta.env.VITE_APP_DISABLE_PREVENT_UNLOAD !== "true") {
          preventUnload(event);
        } else {
          console.warn(
            "preventing unload disabled (VITE_APP_DISABLE_PREVENT_UNLOAD)",
          );
        }
      }
    };
    window.addEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    return () => {
      window.removeEventListener(EVENT.BEFORE_UNLOAD, unloadHandler);
    };
  }, [excalidrawAPI]);

  const onChange = (
    elements: readonly OrderedExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    if (collabAPI?.isCollaborating()) {
      collabAPI.syncElements(elements);
    }

    // this check is redundant, but since this is a hot path, it's best
    // not to evaludate the nested expression every time
    if (!LocalData.isSavePaused()) {
      LocalData.save(elements, appState, files, () => {
        if (excalidrawAPI) {
          let didChange = false;

          const elements = excalidrawAPI
            .getSceneElementsIncludingDeleted()
            .map((element) => {
              if (
                LocalData.fileStorage.shouldUpdateImageElementStatus(element)
              ) {
                const newElement = newElementWith(element, { status: "saved" });
                if (newElement !== element) {
                  didChange = true;
                }
                return newElement;
              }
              return element;
            });

          if (didChange) {
            excalidrawAPI.updateScene({
              elements,
              captureUpdate: CaptureUpdateAction.NEVER,
            });
          }
        }
      });
    }

    // Render the debug scene if the debug canvas is available
    if (debugCanvasRef.current && excalidrawAPI) {
      debugRenderer(
        debugCanvasRef.current,
        appState,
        elements,
        window.devicePixelRatio,
      );
    }
  };

  const [latestShareableLink, setLatestShareableLink] = useState<string | null>(
    null,
  );

  const onExportToBackend = async (
    exportedElements: readonly NonDeletedExcalidrawElement[],
    appState: Partial<AppState>,
    files: BinaryFiles,
  ) => {
    if (exportedElements.length === 0) {
      throw new Error(t("alerts.cannotExportEmptyCanvas"));
    }
    try {
      const { url, errorMessage } = await exportToBackend(
        exportedElements,
        {
          ...appState,
          viewBackgroundColor: appState.exportBackground
            ? appState.viewBackgroundColor
            : getDefaultAppState().viewBackgroundColor,
        },
        files,
      );

      if (errorMessage) {
        throw new Error(errorMessage);
      }

      if (url) {
        setLatestShareableLink(url);
      }
    } catch (error: any) {
      if (error.name !== "AbortError") {
        const { width, height } = appState;
        console.error(error, {
          width,
          height,
          devicePixelRatio: window.devicePixelRatio,
        });
        throw new Error(error.message);
      }
    }
  };

  const renderCustomStats = (
    elements: readonly NonDeletedExcalidrawElement[],
    appState: UIAppState,
  ) => {
    return (
      <CustomStats
        setToast={(message) => excalidrawAPI!.setToast({ message })}
        appState={appState}
        elements={elements}
      />
    );
  };

  const isOffline = useAtomValue(isOfflineAtom);

  const localStorageQuotaExceeded = useAtomValue(localStorageQuotaExceededAtom);

  const onCollabDialogOpen = useCallback(
    () => setShareDialogState({ isOpen: true, type: "collaborationOnly" }),
    [setShareDialogState],
  );

  // ---------------------------------------------------------------------------
  // onExport — intercepts file save to wait for pending image loads
  // ---------------------------------------------------------------------------
  const onExport: Required<ExcalidrawProps>["onExport"] = useCallback(
    async function* () {
      let snapshot = FileStatusStore.getSnapshot();
      const { pending, total } = FileStatusStore.getPendingCount(
        snapshot.value,
      );
      if (pending === 0) {
        return;
      }

      // Yield initial progress
      yield {
        type: "progress",
        progress: (total - pending) / total,
        message: `Loading images (${total - pending}/${total})...`,
      };

      // Wait for all pending images to finish
      while (true) {
        snapshot = await FileStatusStore.pull(snapshot.version);
        const { pending: nowPending, total: nowTotal } =
          FileStatusStore.getPendingCount(snapshot.value);

        yield {
          type: "progress",
          progress: (nowTotal - nowPending) / nowTotal,
          message: `Loading images (${nowTotal - nowPending}/${nowTotal})...`,
        };

        if (nowPending === 0) {
          await new Promise((r) => setTimeout(r, 500));
          yield {
            type: "progress",
            message: `Preparing export...`,
          };
          return;
        }
      }
    },
    [],
  );

  // const onExport = () => {
  //   return new Promise((r) => setTimeout(r, 2500));
  //   // console.log("onExport");
  // };

  // browsers generally prevent infinite self-embedding, there are
  // cases where it still happens, and while we disallow self-embedding
  // by not whitelisting our own origin, this serves as an additional guard
  if (isSelfEmbedding) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          height: "100%",
        }}
      >
        <h1>I'm not a pretzel!</h1>
      </div>
    );
  }

  const ExcalidrawPlusCommand = {
    label: "Excalidraw+",
    category: DEFAULT_CATEGORIES.links,
    predicate: true,
    icon: <div style={{ width: 14 }}>{ExcalLogo}</div>,
    keywords: ["plus", "cloud", "server"],
    perform: () => {
      window.open(
        `${
          import.meta.env.VITE_APP_PLUS_LP
        }/plus?utm_source=excalidraw&utm_medium=app&utm_content=command_palette`,
        "_blank",
      );
    },
  };
  const ExcalidrawPlusAppCommand = {
    label: "Sign up",
    category: DEFAULT_CATEGORIES.links,
    predicate: true,
    icon: <div style={{ width: 14 }}>{ExcalLogo}</div>,
    keywords: [
      "excalidraw",
      "plus",
      "cloud",
      "server",
      "signin",
      "login",
      "signup",
    ],
    perform: () => {
      window.open(
        `${
          import.meta.env.VITE_APP_PLUS_APP
        }?utm_source=excalidraw&utm_medium=app&utm_content=command_palette`,
        "_blank",
      );
    },
  };

  return (
    <div
      style={{ height: "100%" }}
      className={clsx("excalidraw-app", {
        "is-collaborating": isCollaborating,
      })}
    >
      <Excalidraw
        onChange={onChange}
        onExport={onExport}
        initialData={initialStatePromiseRef.current.promise}
        isCollaborating={isCollaborating}
        onPointerUpdate={collabAPI?.onPointerUpdate}
        UIOptions={{
          canvasActions: {
            toggleTheme: true,
            export: {
              onExportToBackend,
              renderCustomUI: excalidrawAPI
                ? (elements, appState, files) => {
                    return (
                      <ExportToExcalidrawPlus
                        elements={elements}
                        appState={appState}
                        files={files}
                        name={excalidrawAPI.getName()}
                        onError={(error) => {
                          excalidrawAPI?.updateScene({
                            appState: {
                              errorMessage: error.message,
                            },
                          });
                        }}
                        onSuccess={() => {
                          excalidrawAPI.updateScene({
                            appState: { openDialog: null },
                          });
                        }}
                      />
                    );
                  }
                : undefined,
            },
          },
        }}
        langCode={langCode}
        renderCustomStats={renderCustomStats}
        detectScroll={false}
        handleKeyboardGlobally={true}
        autoFocus={true}
        theme={editorTheme}
        renderTopRightUI={(isMobile) => {
          if (isMobile || !collabAPI || isCollabDisabled) {
            return null;
          }

          return (
            <div className="excalidraw-ui-top-right">
              <button
                onClick={playAudio}
                className={`plus-banner ${isPlayingAudio ? "glow-active" : ""}`}
                style={{ marginRight: "4px", gap: "6px", display: "flex", alignItems: "center" }}
                title="Narrate Problem Description"
              >
                <Volume2 size={16} />
                <span>{isPlayingAudio ? "Stop Voice" : "Narrate"}</span>
              </button>

              <button
                onClick={() => setIsDrawerOpen(!isDrawerOpen)}
                className="plus-banner"
                style={{ marginRight: "4px", gap: "6px", display: "flex", alignItems: "center" }}
                title="Whiteboard Problems & Customizer Drawer"
              >
                <BookOpen size={16} />
                <span>Workspace</span>
              </button>

              <button
                onClick={() => {
                  const isSidebarOpen = excalidrawAPI?.getAppState().openSidebar?.name === "code-console";
                  if (isSidebarOpen) {
                    excalidrawAPI?.updateScene({ appState: { openSidebar: null } });
                  } else {
                    excalidrawAPI?.updateScene({ appState: { openSidebar: { name: "code-console" } } });
                  }
                }}
                className="plus-banner"
                style={{ marginRight: "4px", gap: "6px", display: "flex", alignItems: "center" }}
                title="Toggle Monaco Code Console"
              >
                <Code2 size={16} />
                <span>Console</span>
              </button>

              {excalidrawAPI?.getEditorInterface().formFactor === "desktop" && (
                <ExcalidrawPlusPromoBanner
                  isSignedIn={isExcalidrawPlusSignedUser}
                />
              )}

              {collabError.message && <CollabError collabError={collabError} />}
              <LiveCollaborationTrigger
                isCollaborating={isCollaborating}
                onSelect={() =>
                  setShareDialogState({ isOpen: true, type: "share" })
                }
                editorInterface={editorInterface}
              />
            </div>
          );
        }}
        onLinkOpen={(element, event) => {
          if (element.link && isElementLink(element.link)) {
            event.preventDefault();
            excalidrawAPI?.scrollToContent(element.link, { animate: true });
          }
        }}
      >
        <AppMainMenu
          onCollabDialogOpen={onCollabDialogOpen}
          isCollaborating={isCollaborating}
          isCollabEnabled={!isCollabDisabled}
          theme={appTheme}
          setTheme={(theme) => setAppTheme(theme)}
          refresh={() => forceRefresh((prev) => !prev)}
        />
        <AppWelcomeScreen
          onCollabDialogOpen={onCollabDialogOpen}
          isCollabEnabled={!isCollabDisabled}
        />
        <OverwriteConfirmDialog>
          <OverwriteConfirmDialog.Actions.ExportToImage />
          <OverwriteConfirmDialog.Actions.SaveToDisk />
          {excalidrawAPI && (
            <OverwriteConfirmDialog.Action
              title={t("overwriteConfirm.action.excalidrawPlus.title")}
              actionLabel={t("overwriteConfirm.action.excalidrawPlus.button")}
              onClick={() => {
                exportToExcalidrawPlus(
                  excalidrawAPI.getSceneElements(),
                  excalidrawAPI.getAppState(),
                  excalidrawAPI.getFiles(),
                  excalidrawAPI.getName(),
                );
              }}
            >
              {t("overwriteConfirm.action.excalidrawPlus.description")}
            </OverwriteConfirmDialog.Action>
          )}
        </OverwriteConfirmDialog>
        <AppFooter onChange={() => excalidrawAPI?.refresh()} />
        {excalidrawAPI && <AIComponents excalidrawAPI={excalidrawAPI} />}

        <TTDDialogTrigger />
        {isCollaborating && isOffline && (
          <div className="alertalert--warning">
            {t("alerts.collabOfflineWarning")}
          </div>
        )}
        {localStorageQuotaExceeded && (
          <div className="alert alert--danger">
            {t("alerts.localStorageQuotaExceeded")}
          </div>
        )}
        {latestShareableLink && (
          <ShareableLinkDialog
            link={latestShareableLink}
            onCloseRequest={() => setLatestShareableLink(null)}
            setErrorMessage={setErrorMessage}
          />
        )}
        {excalidrawAPI && !isCollabDisabled && (
          <Collab excalidrawAPI={excalidrawAPI} />
        )}

        <ShareDialog
          collabAPI={collabAPI}
          onExportToBackend={async () => {
            if (excalidrawAPI) {
              try {
                await onExportToBackend(
                  excalidrawAPI.getSceneElements(),
                  excalidrawAPI.getAppState(),
                  excalidrawAPI.getFiles(),
                );
              } catch (error: any) {
                setErrorMessage(error.message);
              }
            }
          }}
        />

        <AppSidebar />
        
        <Sidebar name="code-console" className="code-console-sidebar">
          <Sidebar.Header>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Code size={18} style={{ color: "var(--accent)" }} />
              <span style={{ fontWeight: 700, fontSize: "0.95rem" }}>
                {activeProblem ? activeProblem.title : "Code Console"}
              </span>
            </div>
          </Sidebar.Header>
          <div className="console-panel-content">
            <div className="editor-tabs">
              <button 
                onClick={() => setActiveEditorTab("code")}
                className={`editor-tab-item ${activeEditorTab === "code" ? "active" : ""}`}
              >
                Solution.js
              </button>
              <button 
                onClick={() => setActiveEditorTab("instructions")}
                className={`editor-tab-item ${activeEditorTab === "instructions" ? "active" : ""}`}
              >
                Description.md
              </button>
            </div>

            <div className="editor-mount-container">
              {activeEditorTab === "code" ? (
                <Editor
                  height="100%"
                  language="javascript"
                  theme={activeTheme === "light" ? "vs" : "vs-dark"}
                  options={{
                    fontSize: 13,
                    fontFamily: "var(--font-mono)",
                    minimap: { enabled: false },
                    wordWrap: "on",
                    lineNumbers: "on",
                    scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
                    padding: { top: 12 }
                  }}
                  onMount={handleEditorDidMount}
                />
              ) : (
                <div style={{ 
                  padding: "20px", 
                  height: "100%", 
                  overflowY: "auto", 
                  color: "var(--text-main)", 
                  fontSize: "0.85rem",
                  lineHeight: 1.6,
                  background: "var(--bg-card)"
                }}>
                  <h3 style={{ marginTop: 0, color: "var(--accent)" }}>{activeProblem?.title}</h3>
                  <p style={{ whiteSpace: "pre-wrap" }}>{activeProblem?.description}</p>
                  <div style={{ marginTop: "24px", paddingTop: "12px", borderTop: "1px dashed var(--border-glass)" }}>
                    <h4 style={{ margin: "0 0 8px 0", color: "var(--secondary)" }}>Speech Explanation</h4>
                    <p style={{ fontStyle: "italic", color: "var(--text-dark)", margin: 0 }}>{activeProblem?.explanationText}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="runner-container">
              <div className="runner-tab-bar">
                <div className="runner-tab-triggers">
                  <button 
                    onClick={() => setActiveResultTab("interactive")}
                    className={`runner-trigger-btn ${activeResultTab === "interactive" ? "active" : ""}`}
                  >
                    Interactive
                  </button>
                  <button 
                    onClick={() => setActiveResultTab("results")}
                    className={`runner-trigger-btn ${activeResultTab === "results" ? "active" : ""}`}
                  >
                    Results ({testResults.filter(r => r.passed).length}/{sandboxTestCases.length})
                  </button>
                </div>

                <button
                  onClick={runTests}
                  className="btn-primary"
                  style={{ padding: "4px 12px", fontSize: "0.75rem", borderRadius: "4px", display: "flex", alignItems: "center", gap: "4px" }}
                >
                  <Play size={12} />
                  <span>Run Tests</span>
                </button>
              </div>

              <div className="runner-body-panel">
                {activeResultTab === "interactive" ? (
                  <div>
                    <div className="tc-switcher-dock">
                      {sandboxTestCases.map((tc: any, idx: number) => {
                        const res = testResults[idx];
                        const statusClass = res ? (res.passed ? "passed" : "failed") : "";
                        return (
                          <div
                            key={idx}
                            onClick={() => setActiveTestCaseIdx(idx)}
                            className={`tc-selector-pill ${idx === activeTestCaseIdx ? "active" : ""} ${statusClass}`}
                          >
                            {res ? (res.passed ? <Check size={12} /> : <LucideX size={12} />) : null}
                            <span>Case {idx + 1}</span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="login-input-group" style={{ marginBottom: "12px" }}>
                      <label className="login-label">TEST CASE INPUT</label>
                      <div style={{ background: "rgba(0,0,0,0.15)", border: "1px solid var(--border-glass)", borderRadius: "6px", padding: "8px 12px", fontSize: "0.75rem", fontFamily: "var(--font-mono)", color: "var(--text-main)", wordBreak: "break-all" }}>
                        {sandboxTestCases[activeTestCaseIdx]?.input}
                      </div>
                    </div>

                    <div className="login-input-group" style={{ marginBottom: "12px" }}>
                      <label className="login-label">EXPECTED OUTPUT</label>
                      <div style={{ background: "rgba(0,0,0,0.15)", border: "1px solid var(--border-glass)", borderRadius: "6px", padding: "8px 12px", fontSize: "0.75rem", fontFamily: "var(--font-mono)", color: "var(--success)" }}>
                        {sandboxTestCases[activeTestCaseIdx]?.expectedOutput}
                      </div>
                    </div>

                    {testResults[activeTestCaseIdx] && (
                      <div className="login-input-group">
                        <label className="login-label">ACTUAL OUTCOME</label>
                        <div style={{ 
                          background: "rgba(0,0,0,0.15)", 
                          border: "1px solid var(--border-glass)", 
                          borderRadius: "6px", 
                          padding: "8px 12px", 
                          fontSize: "0.75rem", 
                          fontFamily: "var(--font-mono)", 
                          color: testResults[activeTestCaseIdx]?.passed ? "var(--success)" : "var(--error)",
                          wordBreak: "break-all"
                        }}>
                          {testResults[activeTestCaseIdx]?.actual}
                        </div>
                      </div>
                    )}

                    {testResults[activeTestCaseIdx]?.logs && testResults[activeTestCaseIdx].logs.length > 0 && (
                      <div className="neon-terminal-logs">
                        <div className="terminal-line system">=== RUNTIME TERMINAL LOGS ===</div>
                        {testResults[activeTestCaseIdx].logs.map((log: string, lIdx: number) => (
                          <div key={lIdx} className="terminal-line print">
                            &gt; {log}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {testResults.length === 0 ? (
                      <div style={{ textAlign: "center", color: "var(--text-dark)", padding: "20px", fontSize: "0.8rem" }}>
                        Run tests to view structured results suite.
                      </div>
                    ) : (
                      testResults.map((res, idx) => (
                        <div key={idx} style={{ 
                          padding: "12px", 
                          background: "rgba(0,0,0,0.2)", 
                          border: `1px solid ${res.passed ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`, 
                          borderRadius: "8px" 
                        }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                            <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-main)" }}>Test Case #{idx + 1}</span>
                            <span style={{ 
                              fontSize: "0.7rem", 
                              padding: "2px 6px", 
                              borderRadius: "4px", 
                              fontWeight: 700, 
                              background: res.passed ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                              color: res.passed ? 'var(--success)' : 'var(--error)'
                            }}>
                              {res.passed ? "PASSED" : "FAILED"}
                            </span>
                          </div>
                          <div style={{ fontSize: "0.7rem", color: "var(--text-dark)", display: "flex", flexDirection: "column", gap: "2px" }}>
                            <div>Input: {res.input}</div>
                            <div>Expected: {res.expected}</div>
                            <div>Actual: {res.actual}</div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </Sidebar>

        {errorMessage && (
          <ErrorDialog onClose={() => setErrorMessage("")}>
            {errorMessage}
          </ErrorDialog>
        )}

        <CommandPalette
          customCommandPaletteItems={[
            {
              label: t("labels.liveCollaboration"),
              category: DEFAULT_CATEGORIES.app,
              keywords: [
                "team",
                "multiplayer",
                "share",
                "public",
                "session",
                "invite",
              ],
              icon: usersIcon,
              perform: () => {
                setShareDialogState({
                  isOpen: true,
                  type: "collaborationOnly",
                });
              },
            },
            {
              label: t("roomDialog.button_stopSession"),
              category: DEFAULT_CATEGORIES.app,
              predicate: () => !!collabAPI?.isCollaborating(),
              keywords: [
                "stop",
                "session",
                "end",
                "leave",
                "close",
                "exit",
                "collaboration",
              ],
              perform: () => {
                if (collabAPI) {
                  collabAPI.stopCollaboration();
                  if (!collabAPI.isCollaborating()) {
                    setShareDialogState({ isOpen: false });
                  }
                }
              },
            },
            {
              label: t("labels.share"),
              category: DEFAULT_CATEGORIES.app,
              predicate: true,
              icon: share,
              keywords: [
                "link",
                "shareable",
                "readonly",
                "export",
                "publish",
                "snapshot",
                "url",
                "collaborate",
                "invite",
              ],
              perform: async () => {
                setShareDialogState({ isOpen: true, type: "share" });
              },
            },
            {
              label: "GitHub",
              icon: GithubIcon,
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              keywords: [
                "issues",
                "bugs",
                "requests",
                "report",
                "features",
                "social",
                "community",
              ],
              perform: () => {
                window.open(
                  "https://github.com/excalidraw/excalidraw",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            {
              label: t("labels.followUs"),
              icon: XBrandIcon,
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              keywords: ["twitter", "contact", "social", "community"],
              perform: () => {
                window.open(
                  "https://x.com/excalidraw",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            {
              label: t("labels.discordChat"),
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              icon: DiscordIcon,
              keywords: [
                "chat",
                "talk",
                "contact",
                "bugs",
                "requests",
                "report",
                "feedback",
                "suggestions",
                "social",
                "community",
              ],
              perform: () => {
                window.open(
                  "https://discord.gg/UexuTaE",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            {
              label: "YouTube",
              icon: youtubeIcon,
              category: DEFAULT_CATEGORIES.links,
              predicate: true,
              keywords: ["features", "tutorials", "howto", "help", "community"],
              perform: () => {
                window.open(
                  "https://youtube.com/@excalidraw",
                  "_blank",
                  "noopener noreferrer",
                );
              },
            },
            ...(isExcalidrawPlusSignedUser
              ? [
                  {
                    ...ExcalidrawPlusAppCommand,
                    label: "Sign in / Go to Excalidraw+",
                  },
                ]
              : [ExcalidrawPlusCommand, ExcalidrawPlusAppCommand]),

            {
              label: t("overwriteConfirm.action.excalidrawPlus.button"),
              category: DEFAULT_CATEGORIES.export,
              icon: exportToPlus,
              predicate: true,
              keywords: ["plus", "export", "save", "backup"],
              perform: () => {
                if (excalidrawAPI) {
                  exportToExcalidrawPlus(
                    excalidrawAPI.getSceneElements(),
                    excalidrawAPI.getAppState(),
                    excalidrawAPI.getFiles(),
                    excalidrawAPI.getName(),
                  );
                }
              },
            },
            {
              ...CommandPalette.defaultItems.toggleTheme,
              perform: () => {
                setAppTheme(
                  editorTheme === THEME.DARK ? THEME.LIGHT : THEME.DARK,
                );
              },
            },
            {
              label: t("labels.installPWA"),
              category: DEFAULT_CATEGORIES.app,
              predicate: () => !!pwaEvent,
              perform: () => {
                if (pwaEvent) {
                  pwaEvent.prompt();
                  pwaEvent.userChoice.then(() => {
                    // event cannot be reused, but we'll hopefully
                    // grab new one as the event should be fired again
                    pwaEvent = null;
                  });
                }
              },
            },
          ]}
        />
        {isVisualDebuggerEnabled() && excalidrawAPI && (
          <DebugCanvas
            appState={excalidrawAPI.getAppState()}
            scale={window.devicePixelRatio}
            ref={debugCanvasRef}
          />
        )}
      </Excalidraw>

      {/* Unified Left Sidebar Control Panel Drawer */}
      <div className={clsx("whiteboard-drawer", { open: isDrawerOpen })}>
        <div className="drawer-header">
          <div>
            <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700 }} className="text-gradient">
              {drawerTab === "library" ? "CodeGraph Library" : drawerTab === "creator" ? "Architect Panel" : "Aesthetic Customizer"}
            </h3>
            <div className="text-dark" style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)", marginTop: "2px" }}>
              {drawerTab === "library" ? "Select a sandbox dataset" : drawerTab === "creator" ? "Create custom algorithm playground" : "Switch premium color templates"}
            </div>
          </div>
          <button 
            onClick={() => setIsDrawerOpen(false)}
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border-glass)", color: "var(--text-main)", borderRadius: "50%", width: "32px", height: "32px", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
          >
            <LucideX size={16} />
          </button>
        </div>

        <div className="drawer-body">
          {/* TAB 1: Library Problems Grid List */}
          {drawerTab === "library" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {problems.map((p) => {
                const isActive = activeProblem?.id === p.id;
                return (
                  <div 
                    key={p.id}
                    onClick={() => handleSelectProblem(p)}
                    style={{
                      padding: "16px",
                      background: isActive ? "rgba(99, 102, 241, 0.08)" : "rgba(255, 255, 255, 0.02)",
                      border: isActive ? "1.5px solid var(--accent)" : "1px solid var(--border-glass)",
                      borderRadius: "10px",
                      cursor: "pointer",
                      transition: "all 0.2s"
                    }}
                    className="hover-card"
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "6px" }}>
                      <h4 style={{ margin: 0, fontSize: "0.95rem", color: isActive ? "var(--accent)" : "var(--text-main)", fontWeight: 600 }}>{p.title}</h4>
                      <span style={{ 
                        fontSize: "0.7rem", 
                        padding: "2px 6px", 
                        borderRadius: "4px",
                        fontWeight: 600,
                        color: p.difficulty === 'Easy' ? 'var(--success)' : p.difficulty === 'Medium' ? 'var(--warning)' : 'var(--error)',
                        background: p.difficulty === 'Easy' ? 'rgba(16, 185, 129, 0.08)' : p.difficulty === 'Medium' ? 'rgba(251, 191, 36, 0.08)' : 'rgba(244, 63, 94, 0.08)'
                      }}>
                        {p.difficulty}
                      </span>
                    </div>
                    <p className="text-dark" style={{ fontSize: "0.8rem", margin: 0, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", lineHeight: 1.4 }}>
                      {p.description.replace(/[#*`]/g, "")}
                    </p>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "10px", paddingTop: "8px", borderTop: "1px dashed var(--border-glass)" }}>
                      <span style={{ fontSize: "0.7rem", color: "var(--text-dark)" }}>Sync Session: WebRTC P2P</span>
                      <span style={{ fontSize: "0.75rem", color: "var(--accent)", fontWeight: 500, display: "flex", alignItems: "center", gap: "2px" }}>
                        Open board <ChevronRight size={12} />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* TAB 2: Dynamic Problem Creator Form */}
          {drawerTab === "creator" && (
            <form onSubmit={handleCreateProblem} style={{ display: "flex", flexDirection: "column", gap: "16px", paddingBottom: "30px" }}>
              {creatorMsg && (
                <div className="floating-alert-badge" style={{ background: "rgba(16,185,129,0.1)", color: "var(--success)", border: "1px solid rgba(16,185,129,0.25)" }}>
                  <span>{creatorMsg}</span>
                </div>
              )}

              <div className="login-input-group">
                <label className="login-label">PROBLEM TITLE</label>
                <input 
                  type="text" 
                  value={newTitle} 
                  onChange={(e) => setNewTitle(e.target.value)} 
                  placeholder="e.g. Merge Sorted Array" 
                  className="overlay-input"
                  required
                />
              </div>

              <div className="login-input-group">
                <label className="login-label">DIFFICULTY</label>
                <select 
                  value={newDiff} 
                  onChange={(e: any) => setNewDiff(e.target.value)} 
                  className="overlay-input"
                  style={{ cursor: "pointer" }}
                >
                  <option value="Easy">Easy</option>
                  <option value="Medium">Medium</option>
                  <option value="Hard">Hard</option>
                </select>
              </div>

              <div className="login-input-group">
                <label className="login-label">DESCRIPTION (MARKDOWN SUPPORT)</label>
                <textarea 
                  rows={4}
                  value={newDesc} 
                  onChange={(e) => setNewDesc(e.target.value)} 
                  placeholder="Define problem statement, inputs, outputs, and constraints..." 
                  className="overlay-input"
                  style={{ fontSize: "0.85rem", resize: "none" }}
                  required
                />
              </div>

              <div className="login-input-group">
                <label className="login-label">EXPLANATION SPEECH TEXT</label>
                <textarea 
                  rows={3}
                  value={newSpeech} 
                  onChange={(e) => setNewSpeech(e.target.value)} 
                  placeholder="Provide deep breakdown for narrator..." 
                  className="overlay-input"
                  style={{ fontSize: "0.85rem", resize: "none" }}
                />
              </div>

              {/* Custom testcase params */}
              <div className="login-input-group">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <label className="login-label">SANDBOX TEST CASES</label>
                  <button 
                    type="button" 
                    onClick={() => setNewCases([...newCases, { input: "", expectedOutput: "" }])} 
                    className="btn-outline" 
                    style={{ padding: "2px 8px", fontSize: "0.7rem", borderRadius: "4px" }}
                  >
                    + Add Case
                  </button>
                </div>
                
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {newCases.map((tc, idx) => (
                    <div 
                      key={idx} 
                      style={{ 
                        padding: "10px", 
                        background: "rgba(0,0,0,0.2)", 
                        borderRadius: "8px", 
                        border: "1px solid var(--border-glass)" 
                      }}
                      className="login-input-group"
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--secondary)" }}>CASE #{idx + 1}</span>
                        {newCases.length > 1 && (
                          <button 
                            type="button" 
                            onClick={() => setNewCases(newCases.filter((_, i) => i !== idx))} 
                            style={{ background: "none", border: "none", color: "var(--error)", cursor: "pointer", fontSize: "0.7rem" }}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      <input 
                        type="text" 
                        value={tc.input} 
                        onChange={(e) => {
                          const updated = [...newCases];
                          updated[idx].input = e.target.value;
                          setNewCases(updated);
                        }} 
                        placeholder='Input JSON (e.g. {"nums": [1,2], "val": 3})' 
                        className="overlay-input"
                        style={{ fontSize: "0.75rem", padding: "6px 10px" }}
                        required
                      />
                      <input 
                        type="text" 
                        value={tc.expectedOutput} 
                        onChange={(e) => {
                          const updated = [...newCases];
                          updated[idx].expectedOutput = e.target.value;
                          setNewCases(updated);
                        }} 
                        placeholder="Expected Output JSON or String" 
                        className="overlay-input"
                        style={{ fontSize: "0.75rem", padding: "6px 10px" }}
                        required
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", gap: "10px", marginTop: "1rem" }}>
                <button 
                  type="submit" 
                  className="btn-primary" 
                  style={{ flex: 1, padding: "10px", borderRadius: "8px" }}
                >
                  Create Playground
                </button>
                <button 
                  type="button" 
                  onClick={() => setIsDrawerOpen(false)} 
                  className="btn-outline" 
                  style={{ padding: "10px 18px", borderRadius: "8px" }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: Visual Theme Customizer Card Selectors */}
          {drawerTab === "themes" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {[
                { id: "cyberpunk", name: "Neon Night", subtitle: "Cyberpunk violet & pink neon", colors: ["#6366f1", "#ec4899", "#8b5cf6"], bg: "#090a0f" },
                { id: "matrix", name: "Emerald Matrix", subtitle: "Digital code hacker green", colors: ["#10b981", "#34d399", "#047857"], bg: "#020804" },
                { id: "solar", name: "Solar Gold", subtitle: "Warm amber gold & charcoal", colors: ["#fbbf24", "#f97316", "#ea580c"], bg: "#0d0c0a" },
                { id: "slate", name: "Minimalist Slate", subtitle: "Muted corporate slate blue", colors: ["#3b82f6", "#6366f1", "#0284c7"], bg: "#0f172a" },
                { id: "light", name: "Soft Light Mode", subtitle: "Clean bright slate layout", colors: ["#4f46e5", "#db2777", "#7c3aed"], bg: "#f8fafc" }
              ].map((theme) => {
                const isActive = activeTheme === theme.id;
                const isThemeLight = theme.id === "light";
                return (
                  <div
                    key={theme.id}
                    onClick={() => handleSelectTheme(theme.id)}
                    style={{
                      padding: "20px",
                      background: theme.bg,
                      borderRadius: "14px",
                      border: "2px solid",
                      borderColor: isActive 
                        ? theme.colors[0] 
                        : (isThemeLight ? "rgba(0, 0, 0, 0.08)" : "rgba(255, 255, 255, 0.05)"),
                      cursor: "pointer",
                      transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                      boxShadow: isActive 
                        ? `0 0 20px rgba(99, 102, 241, 0.15)` 
                        : "0 4px 15px rgba(0,0,0,0.3)"
                    }}
                    className="hover-card"
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                      <div>
                        <h4 style={{ margin: 0, fontSize: "1.05rem", color: isThemeLight ? "#0f172a" : "#fff", fontWeight: 700 }}>{theme.name}</h4>
                        <span style={{ fontSize: "0.75rem", color: isThemeLight ? "rgba(15,23,42,0.6)" : "rgba(255,255,255,0.4)", display: "block", marginTop: "2px" }}>{theme.subtitle}</span>
                      </div>
                      {isActive && (
                        <div style={{ background: theme.colors[0], color: "#fff", borderRadius: "50%", width: "22px", height: "22px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <Check size={12} strokeWidth={3} />
                        </div>
                      )}
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "16px", paddingTop: "8px", borderTop: `1px dashed ${isThemeLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)'}` }}>
                      <div style={{ display: "flex", gap: "6px" }}>
                        {theme.colors.map((c, i) => (
                          <span key={i} style={{ background: c, width: "12px", height: "12px", borderRadius: "50%", display: "inline-block" }}></span>
                        ))}
                      </div>
                      <span style={{ fontSize: "0.7rem", color: isThemeLight ? "rgba(15,23,42,0.4)" : "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>Select Palette</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Floating Vertical Navigation Dock */}
      <nav className="floating-navigation-dock">
        <div className="floating-dock-item active" title="Active Playboard" style={{ background: "linear-gradient(135deg, var(--accent), var(--secondary))" }}>
          <Sparkles size={20} color="#fff" />
        </div>

        <div className="floating-dock-divider"></div>

        <button 
          onClick={() => handleToggleTab("library")} 
          className={`floating-dock-item ${isDrawerOpen && drawerTab === "library" ? "active" : ""}`}
          title="Problem Library"
        >
          <BookOpen size={20} />
        </button>

        <button 
          onClick={() => handleToggleTab("creator")} 
          className={`floating-dock-item ${isDrawerOpen && drawerTab === "creator" ? "active" : ""}`}
          title="Create Custom Problem"
        >
          <PlusCircle size={20} />
        </button>

        <button 
          onClick={() => handleToggleTab("themes")} 
          className={`floating-dock-item ${isDrawerOpen && drawerTab === "themes" ? "active" : ""}`}
          title="Aesthetic Workspace Themes"
        >
          <Palette size={20} />
        </button>
      </nav>
      
      {/* Retain hover style inject */}
      <style dangerouslySetInnerHTML={{ __html: `
        .hover-card:hover {
          background: rgba(255, 255, 255, 0.04) !important;
          border-color: var(--accent) !important;
        }
      `}} />
    </div>
  );
};

const ExcalidrawApp = () => {
  const isCloudExportWindow =
    window.location.pathname === "/excalidraw-plus-export";
  if (isCloudExportWindow) {
    return <ExcalidrawPlusIframeExport />;
  }

  return (
    <TopErrorBoundary>
      <Provider store={appJotaiStore}>
        <ExcalidrawAPIProvider>
          <ExcalidrawWrapper />
        </ExcalidrawAPIProvider>
      </Provider>
    </TopErrorBoundary>
  );
};

export default ExcalidrawApp;
