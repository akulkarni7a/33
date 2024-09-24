/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ButtonBar, IButton } from '../../../base/browser/ui/button/button.js';
import { createInstantHoverDelegate } from '../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { ActionRunner, IAction, IActionRunner, SubmenuAction, WorkbenchActionExecutedClassification, WorkbenchActionExecutedEvent } from '../../../base/common/actions.js';
import { Codicon } from '../../../base/common/codicons.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { DisposableStore } from '../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { localize } from '../../../nls.js';
import { createAndFillInActionBarActions } from './menuEntryActionViewItem.js';
import { IToolBarRenderOptions } from './toolbar.js';
import { MenuId, IMenuService, MenuItemAction, IMenuActionOptions } from '../common/actions.js';
import { IContextKeyService } from '../../contextkey/common/contextkey.js';
import { IContextMenuService } from '../../contextview/browser/contextView.js';
import { IHoverService } from '../../hover/browser/hover.js';
import { IKeybindingService } from '../../keybinding/common/keybinding.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';

export type IButtonConfigProvider = (action: IAction, index: number) => {
	showIcon?: boolean;
	showLabel?: boolean;
	isSecondary?: boolean;
} | undefined;

export interface IWorkbenchButtonBarOptions {
	telemetrySource?: string;
	buttonConfigProvider?: IButtonConfigProvider;
}

export class WorkbenchButtonBar extends ButtonBar {

	protected readonly _store = new DisposableStore();
	protected readonly _updateStore = new DisposableStore();

	private readonly _actionRunner: IActionRunner;
	private readonly _onDidChange = new Emitter<this>();
	readonly onDidChange: Event<this> = this._onDidChange.event;


	constructor(
		container: HTMLElement,
		private readonly _options: IWorkbenchButtonBarOptions | undefined,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IHoverService private readonly _hoverService: IHoverService,
	) {
		super(container);

		this._actionRunner = this._store.add(new ActionRunner());
		if (_options?.telemetrySource) {
			this._actionRunner.onDidRun(e => {
				telemetryService.publicLog2<WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification>(
					'workbenchActionExecuted',
					{ id: e.action.id, from: _options.telemetrySource! }
				);
			}, undefined, this._store);
		}
	}

	override dispose() {
		this._onDidChange.dispose();
		this._updateStore.dispose();
		this._store.dispose();
		super.dispose();
	}

	update(actions: IAction[], secondary: IAction[]): void {

		const conifgProvider: IButtonConfigProvider = this._options?.buttonConfigProvider ?? (() => ({ showLabel: true }));

		this._updateStore.clear();
		this.clear();

		// Support instamt hover between buttons
		const hoverDelegate = this._updateStore.add(createInstantHoverDelegate());

		for (let i = 0; i < actions.length; i++) {

			const secondary = i > 0;
			const actionOrSubmenu = actions[i];
			let action: IAction;
			let btn: IButton;

			if (actionOrSubmenu instanceof SubmenuAction && actionOrSubmenu.actions.length > 0) {
				const [first, ...rest] = actionOrSubmenu.actions;
				action = <MenuItemAction>first;
				btn = this.addButtonWithDropdown({
					secondary: conifgProvider(action, i)?.isSecondary ?? secondary,
					actionRunner: this._actionRunner,
					actions: rest,
					contextMenuProvider: this._contextMenuService,
					ariaLabel: action.label
				});
			} else {
				action = actionOrSubmenu;
				btn = this.addButton({
					secondary: conifgProvider(action, i)?.isSecondary ?? secondary,
					ariaLabel: action.label
				});
			}

			btn.enabled = action.enabled;
			btn.checked = action.checked ?? false;
			btn.element.classList.add('default-colors');
			if (conifgProvider(action, i)?.showLabel ?? true) {
				btn.label = action.label;
			} else {
				btn.element.classList.add('monaco-text-button');
			}
			if (conifgProvider(action, i)?.showIcon) {
				if (action instanceof MenuItemAction && ThemeIcon.isThemeIcon(action.item.icon)) {
					btn.icon = action.item.icon;
				} else if (action.class) {
					btn.element.classList.add(...action.class.split(' '));
				}
			}
			const kb = this._keybindingService.lookupKeybinding(action.id);
			let tooltip: string;
			if (kb) {
				tooltip = localize('labelWithKeybinding', "{0} ({1})", action.label, kb.getLabel());
			} else {
				tooltip = action.label;
			}
			this._updateStore.add(this._hoverService.setupManagedHover(hoverDelegate, btn.element, tooltip));
			this._updateStore.add(btn.onDidClick(async () => {
				this._actionRunner.run(action);
			}));
		}

		if (secondary.length > 0) {

			const btn = this.addButton({
				secondary: true,
				ariaLabel: localize('moreActions', "More Actions")
			});

			btn.icon = Codicon.dropDownButton;
			btn.element.classList.add('default-colors', 'monaco-text-button');

			btn.enabled = true;
			this._updateStore.add(this._hoverService.setupManagedHover(hoverDelegate, btn.element, localize('moreActions', "More Actions")));
			this._updateStore.add(btn.onDidClick(async () => {
				this._contextMenuService.showContextMenu({
					getAnchor: () => btn.element,
					getActions: () => secondary,
					actionRunner: this._actionRunner,
					onHide: () => btn.element.setAttribute('aria-expanded', 'false')
				});
				btn.element.setAttribute('aria-expanded', 'true');

			}));
		}
		this._onDidChange.fire(this);
	}
}

export interface IMenuWorkbenchButtonBarOptions extends IWorkbenchButtonBarOptions {
	menuOptions?: IMenuActionOptions;

	toolbarOptions?: IToolBarRenderOptions;
}

export class MenuWorkbenchButtonBar extends WorkbenchButtonBar {

	constructor(
		container: HTMLElement,
		menuId: MenuId,
		options: IMenuWorkbenchButtonBarOptions | undefined,
		@IMenuService menuService: IMenuService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IHoverService hoverService: IHoverService,
	) {
		super(container, options, contextMenuService, keybindingService, telemetryService, hoverService);

		const menu = menuService.createMenu(menuId, contextKeyService);
		this._store.add(menu);

		const update = () => {

			this.clear();

			const primary: IAction[] = [];
			const secondary: IAction[] = [];
			createAndFillInActionBarActions(
				menu,
				options?.menuOptions,
				{ primary, secondary },
				options?.toolbarOptions?.primaryGroup
			);

			super.update(primary, secondary);
		};
		this._store.add(menu.onDidChange(update));
		update();
	}

	override dispose() {
		super.dispose();
	}

	override update(_actions: IAction[]): void {
		throw new Error('Use Menu or WorkbenchButtonBar');
	}
}