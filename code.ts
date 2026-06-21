figma.showUI(__html__, { width: 400, height: 560 });

// ── helpers ──────────────────────────────────────────────────────────────────

function isDefaultName(name: string): boolean {
  return /^(Frame|Rectangle|Ellipse|Group|Vector|Line|Polygon|Star|Image|Text|Component|Instance|Section)\s+\d+$/i.test(name);
}

function hasSpacesInsteadOfSlash(name: string): boolean {
  // flag names with plain spaces that look like they intended hierarchy (two words, no slash)
  return !name.includes('/') && /\s/.test(name) && name.length > 1;
}

function startsWithLowercase(name: string): boolean {
  return /^[a-z]/.test(name);
}

// ── audit ─────────────────────────────────────────────────────────────────────

function runAudit() {
  const linked: { id: string; name: string; page: string }[] = [];
  const detached: { id: string; name: string; page: string }[] = [];
  const local: { id: string; name: string; page: string }[] = [];

  for (const page of figma.root.children) {
    const instances = page.findAll(n => n.type === 'INSTANCE') as InstanceNode[];
    for (const inst of instances) {
      const entry = { id: inst.id, name: inst.name, page: page.name };
      if (!inst.mainComponent) {
        detached.push(entry);
      } else if (inst.mainComponent.remote) {
        linked.push(entry);
      } else {
        local.push(entry);
      }
    }
  }

  figma.ui.postMessage({ type: 'audit-result', linked, detached, local });
}

// ── naming ────────────────────────────────────────────────────────────────────

function runNamingCheck() {
  const issues: { id: string; name: string; page: string; reasons: string[] }[] = [];

  for (const page of figma.root.children) {
    const nodes = page.findAll(n =>
      n.type === 'INSTANCE' || n.type === 'FRAME' || n.type === 'COMPONENT' ||
      n.type === 'GROUP' || n.type === 'RECTANGLE' || n.type === 'TEXT'
    );

    for (const node of nodes) {
      const reasons: string[] = [];
      if (isDefaultName(node.name)) reasons.push('Default Figma name');
      if (hasSpacesInsteadOfSlash(node.name)) reasons.push('Use / instead of spaces for grouping');
      if (startsWithLowercase(node.name)) reasons.push('Name should start with uppercase');

      if (reasons.length > 0) {
        issues.push({ id: node.id, name: node.name, page: page.name, reasons });
      }
    }
  }

  figma.ui.postMessage({ type: 'naming-result', issues });
}

// ── swap ──────────────────────────────────────────────────────────────────────

async function searchComponents(query: string) {
  // Search available components in the document and imported libraries
  const allComponents: { key: string; name: string; source: string }[] = [];

  // Local components
  const localComps = figma.root.findAll(n => n.type === 'COMPONENT') as ComponentNode[];
  for (const c of localComps) {
    if (c.name.toLowerCase().includes(query.toLowerCase())) {
      allComponents.push({ key: c.key, name: c.name, source: 'Local' });
    }
  }

  figma.ui.postMessage({ type: 'search-result', components: allComponents });
}

async function swapComponents(nodeIds: string[], componentKey: string) {
  try {
    const component = await figma.importComponentByKeyAsync(componentKey);
    let swapped = 0;

    for (const id of nodeIds) {
      const node = figma.getNodeById(id);
      if (!node) continue;

      if (node.type === 'INSTANCE') {
        node.swapComponent(component);
        swapped++;
      } else {
        // Replace non-instance node with a new instance
        const parent = node.parent;
        if (!parent) continue;
        const idx = parent.children.indexOf(node as SceneNode);
        const newInst = component.createInstance();
        newInst.x = (node as SceneNode).x;
        newInst.y = (node as SceneNode).y;
        newInst.resize((node as SceneNode).width, (node as SceneNode).height);
        parent.insertChild(idx, newInst);
        node.remove();
        swapped++;
      }
    }

    figma.ui.postMessage({ type: 'swap-done', swapped });
  } catch (e) {
    figma.ui.postMessage({ type: 'swap-error', message: String(e) });
  }
}

// ── zoom to node ──────────────────────────────────────────────────────────────

function zoomToNode(nodeId: string, pageName: string) {
  const page = figma.root.children.find(p => p.name === pageName);
  if (page) {
    figma.currentPage = page;
  }
  const node = figma.getNodeById(nodeId) as SceneNode | null;
  if (node) {
    figma.currentPage.selection = [node];
    figma.viewport.scrollAndZoomIntoView([node]);
  }
}

// ── get selected node ids ─────────────────────────────────────────────────────

function sendSelection() {
  const sel = figma.currentPage.selection.map(n => ({ id: n.id, name: n.name }));
  figma.ui.postMessage({ type: 'selection', nodes: sel });
}

// ── message handler ───────────────────────────────────────────────────────────

figma.ui.onmessage = async (msg: {
  type: string;
  nodeId?: string;
  pageName?: string;
  query?: string;
  nodeIds?: string[];
  componentKey?: string;
}) => {
  switch (msg.type) {
    case 'audit':
      runAudit();
      break;
    case 'naming-check':
      runNamingCheck();
      break;
    case 'get-selection':
      sendSelection();
      break;
    case 'search-components':
      await searchComponents(msg.query || '');
      break;
    case 'swap':
      await swapComponents(msg.nodeIds || [], msg.componentKey || '');
      break;
    case 'zoom-to':
      if (msg.nodeId && msg.pageName) zoomToNode(msg.nodeId, msg.pageName);
      break;
    case 'export-report':
      runAudit();
      break;
    case 'cancel':
      figma.closePlugin();
      break;
  }
};
